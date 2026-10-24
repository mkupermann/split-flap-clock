// FallblattUhr.scr – Windows-Bildschirmschoner für die Fallblattuhr.
// Zeigt die Fallblattseite in Chrome im Kiosk-Vollbild und beendet sich bei der
// ersten Maus-/Tastatureingabe, damit Windows die Anmeldeseite anzeigen kann.
//
// Bauen:  screensaver\build.cmd  -> ..\FallblattUhr.scr
// Selftest: csc /define:SELFTEST /target:exe  (eigener Main, Exitcode 0/1)
//
// .NET Framework 4.x, nur Standardbibliotheken + P/Invoke, keine NuGet-Pakete.

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Management;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Windows.Forms;

namespace FallblattUhr
{
    internal static class Program
    {
        private const string ProfileMarker = "FallblattUhrChrome";
        private const string ChromeExe = @"C:\Program Files\Google\Chrome\Application\chrome.exe";
        private const int HelperPort = 8787;
        private const int PollMs = 100;
        private const int StartupGraceSec = 2;

        // ---- P/Invoke ----
        [StructLayout(LayoutKind.Sequential)]
        private struct LASTINPUTINFO
        {
            public uint cbSize;
            public uint dwTime;
        }

        [DllImport("user32.dll")]
        private static extern bool GetLastInputInfo(ref LASTINPUTINFO plii);

        [DllImport("user32.dll")]
        private static extern int ShowCursor(bool bShow);

        /// <summary>
        /// Bildschirmschoner-Modus aus der Kommandozeile: "s" | "p" | "c".
        /// Windows-Konvention, Groß/Klein egal, auch "/p:1234" bzw. "/c:1234".
        /// Leere Argumente oder unbekannte Schalter -> "c" (Konfiguration).
        /// </summary>
        internal static string ParseMode(string[] args)
        {
            if (args == null || args.Length == 0) return "c";
            string a0 = args[0] == null ? "" : args[0].Trim();
            if (a0.Length < 2) return "c";
            char lead = a0[0];
            if (lead != '/' && lead != '-') return "c";
            char k = char.ToLowerInvariant(a0[1]);
            if (k == 's') return "s";
            if (k == 'p') return "p";
            return "c";
        }

#if SELFTEST
        [STAThread]
        private static int Main()
        {
            int fails = 0;
            fails += Expect("s", ParseMode(new[] { "/s" }), "/s");
            fails += Expect("s", ParseMode(new[] { "/S" }), "/S");
            fails += Expect("p", ParseMode(new[] { "/p", "123" }), "/p 123");
            fails += Expect("p", ParseMode(new[] { "/p:123" }), "/p:123");
            fails += Expect("p", ParseMode(new[] { "/P:1234" }), "/P:1234");
            fails += Expect("p", ParseMode(new[] { "/p", "1234" }), "/p 1234");
            fails += Expect("c", ParseMode(new[] { "/c" }), "/c");
            fails += Expect("c", ParseMode(new[] { "/c:123" }), "/c:123");
            fails += Expect("c", ParseMode(new[] { "/C:1234" }), "/C:1234");
            fails += Expect("c", ParseMode(new string[0]), "(leer)");
            fails += Expect("c", ParseMode(null), "(null)");
            fails += Expect("c", ParseMode(new[] { "" }), "(\"\")");
            fails += Expect("s", ParseMode(new[] { "/s", "extra" }), "/s extra");
            fails += Expect("c", ParseMode(new[] { "x" }), "x");
            fails += Expect("c", ParseMode(new[] { "-" }), "-");
            return fails == 0 ? 0 : 1;
        }

        private static int Expect(string expected, string actual, string label)
        {
            if (expected == actual) return 0;
            Console.Error.WriteLine("FAIL " + label + ": expected=" + expected + " actual=" + actual);
            return 1;
        }
#else
        [STAThread]
        private static int Main(string[] args)
        {
            string mode = ParseMode(args);
            if (mode == "p")
            {
                // Vorschau: sofort beenden, nichts anzeigen.
                return 0;
            }
            if (mode == "s")
            {
                RunScreensaver();
                return 0;
            }
            ShowInfo();
            return 0;
        }
#endif

        private static void ShowInfo()
        {
            string exeDir = Path.GetDirectoryName(Application.ExecutablePath);
            string indexPath = Path.Combine(exeDir, "index.html");
            string readmePath = Path.Combine(exeDir, "screensaver", "README.md");
            MessageBox.Show(
                "FallblattUhr – Bildschirmschoner\r\n\r\n" +
                "index.html:\r\n  " + indexPath + "\r\n\r\n" +
                "Anleitung (Bauen/Installieren/Deinstallieren):\r\n  " + readmePath + "\r\n\r\n" +
                "Start des Schoners:  FallblattUhr.scr /s\r\n" +
                "Hinweis: In den Windows-Energieoptionen \"Bei Reaktivierung Anmeldeseite anzeigen\" aktivieren.",
                "FallblattUhr",
                MessageBoxButtons.OK,
                MessageBoxIcon.Information);
        }

        private static void RunScreensaver()
        {
            string exeDir = Path.GetDirectoryName(Application.ExecutablePath);
            string indexPath = Path.Combine(exeDir, "index.html");
            if (!File.Exists(indexPath))
            {
                MessageBox.Show(
                    "index.html wurde nicht gefunden:\r\n  " + indexPath +
                    "\r\n\r\nFallblattUhr.scr muss im Projekt-Root neben index.html liegen.",
                    "FallblattUhr",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error);
                return;
            }

            // 1) Läuft bereits eine Kiosk-Instanz mit unserem Profil? Merken und beenden.
            bool wasKioskRunning = false;
            List<int> existing = GetKioskChromePids();
            if (existing.Count > 0)
            {
                wasKioskRunning = true;
                KillPids(existing);
            }

            // 2) Helper bei Bedarf unsichtbar starten (Fehler ignorieren).
            try
            {
                if (!IsPortListening(HelperPort))
                {
                    string helperDir = Path.Combine(exeDir, "helper");
                    string helperPkg = Path.Combine(helperDir, "package.json");
                    if (File.Exists(helperPkg))
                    {
                        ProcessStartInfo psi = new ProcessStartInfo();
                        psi.FileName = "cmd.exe";
                        psi.Arguments = "/c npm start";
                        psi.WorkingDirectory = helperDir;
                        psi.CreateNoWindow = true;
                        psi.UseShellExecute = false;
                        psi.WindowStyle = ProcessWindowStyle.Hidden;
                        try { Process.Start(psi); }
                        catch { }
                    }
                }
            }
            catch { }

            // 3) Chrome im Kiosk-Vollbild mit ?screensaver=1 starten.
            string saverUrl = BuildFileUrl(indexPath) + "?screensaver=1";
            Process chrome = null;
            try { chrome = StartChrome(saverUrl); }
            catch (Exception ex)
            {
                MessageBox.Show(
                    "Chrome konnte nicht gestartet werden:\r\n  " + ChromeExe + "\r\n\r\n" + ex.Message,
                    "FallblattUhr",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error);
            }

            // 4) Schwarzes Vollbild-Formular + Eingabe-Erkennung.
            try
            {
                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                using (SaverForm form = new SaverForm())
                {
                    uint lastInput = SafeLastInputTick();
                    DateTime started = DateTime.UtcNow;
                    bool done = false;

                    Timer timer = new Timer();
                    timer.Interval = PollMs;
                    timer.Tick += delegate
                    {
                        if (done) return;

                        // Chrome-Prozess verschwindet -> beenden.
                        if (chrome != null && chrome.HasExited)
                        {
                            done = true;
                            form.Close();
                            return;
                        }

                        // Wartezeit nach Start, danach jede Input-Änderung beenden.
                        if ((DateTime.UtcNow - started).TotalSeconds < StartupGraceSec) return;
                        uint now = SafeLastInputTick();
                        if (now != lastInput)
                        {
                            done = true;
                            form.Close();
                        }
                    };
                    timer.Start();
                    form.Show();
                    ShowCursor(false);
                    Application.Run(form);
                    timer.Stop();
                    timer.Dispose();
                    ShowCursor(true);
                }
            }
            catch { }

            // 5) Beenden: nur unsere Chrome-Prozesse töten, Helper laufen lassen.
            KillKioskChrome();

            // 6) Falls vorher eine normale Kiosk-Ansicht lief: wieder starten.
            if (wasKioskRunning)
            {
                try { StartChrome(BuildFileUrl(indexPath)); }
                catch { }
            }
        }

        // ---- Chrome ----

        private static Process StartChrome(string url)
        {
            string localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            string userDataDir = Path.Combine(localAppData, ProfileMarker);
            string args =
                "--kiosk" +
                " --user-data-dir=\"" + userDataDir + "\"" +
                " --no-first-run" +
                " --disable-session-crashed-bubble" +
                " --disable-features=Translate,CalculateNativeWinOcclusion" +
                " --disable-backgrounding-occluded-windows" +
                " --disable-renderer-backgrounding" +
                " --disable-background-timer-throttling" +
                " --autoplay-policy=no-user-gesture-required" +
                " \"" + url + "\"";
            ProcessStartInfo psi = new ProcessStartInfo();
            psi.FileName = ChromeExe;
            psi.Arguments = args;
            psi.UseShellExecute = false;
            return Process.Start(psi);
        }

        private static string BuildFileUrl(string indexPath)
        {
            string p = indexPath.Replace('\\', '/');
            p = p.Replace(" ", "%20");
            return "file:///" + p;
        }

        /// <summary>
        /// PIDs aller chrome.exe-Prozesse, deren Kommandozeile den Profil-Marker enthält.
        /// WMI Win32_Process mit Filter auf "FallblattUhrChrome" – normale Chrome-Fenster bleiben unberührt.
        /// </summary>
        private static List<int> GetKioskChromePids()
        {
            List<int> pids = new List<int>();
            try
            {
                string query =
                    "SELECT ProcessId FROM Win32_Process WHERE Name = 'chrome.exe' AND CommandLine LIKE '%" +
                    ProfileMarker + "%'";
                using (ManagementObjectSearcher searcher = new ManagementObjectSearcher(query))
                using (ManagementObjectCollection results = searcher.Get())
                {
                    foreach (ManagementBaseObject mo in results)
                    {
                        try
                        {
                            object raw = mo["ProcessId"];
                            if (raw != null) pids.Add(Convert.ToInt32(raw));
                        }
                        catch { }
                    }
                }
            }
            catch { }
            return pids;
        }

        private static void KillKioskChrome()
        {
            KillPids(GetKioskChromePids());
        }

        private static void KillPids(List<int> pids)
        {
            foreach (int pid in pids)
            {
                try
                {
                    Process p = Process.GetProcessById(pid);
                    if (!p.HasExited)
                    {
                        p.Kill();
                        p.WaitForExit(2000);
                    }
                }
                catch { }
            }
        }

        // ---- Helper / Netzwerk ----

        private static bool IsPortListening(int port)
        {
            try
            {
                using (TcpClient client = new TcpClient())
                {
                    IAsyncResult ar = client.BeginConnect("127.0.0.1", port, null, null);
                    bool ok = ar.AsyncWaitHandle.WaitOne(300);
                    if (!ok) return false;
                    client.EndConnect(ar);
                    return true;
                }
            }
            catch
            {
                return false;
            }
        }

        // ---- Input ----

        private static uint SafeLastInputTick()
        {
            try
            {
                LASTINPUTINFO lii = new LASTINPUTINFO();
                lii.cbSize = (uint)Marshal.SizeOf(typeof(LASTINPUTINFO));
                if (GetLastInputInfo(ref lii)) return lii.dwTime;
            }
            catch { }
            return 0;
        }
    }

    /// <summary>
    /// Randloses schwarzes Vollbild-Formular als Hintergrund, bis Chrome sichtbar ist.
    /// TopMost aus, damit Chrome darüber liegt; Mauszeiger ausgeblendet.
    /// </summary>
    internal sealed class SaverForm : Form
    {
        public SaverForm()
        {
            FormBorderStyle = FormBorderStyle.None;
            StartPosition = FormStartPosition.Manual;
            WindowState = FormWindowState.Maximized;
            BackColor = System.Drawing.Color.Black;
            ForeColor = System.Drawing.Color.Black;
            TopMost = false;
            ShowInTaskbar = false;
            KeyPreview = true;
            try
            {
                Bounds = Screen.PrimaryScreen.Bounds;
            }
            catch { }
        }

        protected override void OnShown(EventArgs e)
        {
            base.OnShown(e);
            Cursor.Hide();
        }

        protected override void OnFormClosed(FormClosedEventArgs e)
        {
            try { Cursor.Show(); }
            catch { }
            base.OnFormClosed(e);
        }
    }
}
