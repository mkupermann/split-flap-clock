# FallblattUhr.scr – Bildschirmschoner

Vollbild-Bildschirmschoner, der die Fallblattseite in Chrome im Kiosk-Modus anzeigt.
Bei der ersten Maus- oder Tastatureingabe beendet er sich sauber, damit Windows die
Anmeldeseite anzeigen kann.

## Bauen

Im Ordner `screensaver` (oder per Doppelklick):

```cmd
screensaver\build.cmd
```

Voraussetzungen:

- Windows mit .NET Framework 4.x (`C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe`)
- Google Chrome unter `C:\Program Files\Google\Chrome\Application\chrome.exe`

Ausgabe: `FallblattUhr.scr` im Projekt-Root (neben `index.html`).
Die Datei ist in `.gitignore` eingetragen und wird nicht committet.

## Installieren

1. `FallblattUhr.scr` mit **Rechtsklick → Installieren** anklicken.
2. In den **Bildschirmschoner-Einstellungen** (Desktop rechtsklick → Anpassen →
   Sperrbildschirm → Bildschirmschoner-Einstellungen) den Schoner
   **FallblattUhr** auswählen und die Wartezeit einstellen.
3. Wichtig: Option **„Bei Reaktivierung Anmeldeseite anzeigen“** aktivieren.
   Sonst endet der Schoner ohne Windows-Anmeldung.

## Verhalten

| Aufruf | Wirkung |
| --- | --- |
| `FallblattUhr.scr /s` | Schoner starten |
| `FallblattUhr.scr /p <hwnd>` | Vorschau: sofort beenden (Exitcode 0), nichts anzeigen |
| `FallblattUhr.scr /c` oder ohne Argumente | Kurze Info-MessageBox (Pfade, Hinweise) |

Details des Schoner-Ablaufs (`/s`):

- Chrome startet im Kiosk-Vollbild mit demselben Profil wie `Uhr-starten.cmd`
  (`%LOCALAPPDATA%\FallblattUhrChrome`), damit Timer/Stoppuhr-Zustand
  (localStorage) geteilt wird.
- Die Seite `index.html` liegt direkt neben der `.scr`. Der URL-Parameter
  `?screensaver=1` kennzeichnet den Schoner-Betrieb.
- Lief bereits eine Kiosk-Ansicht, wird sie beim Beenden des Schoners wieder
  gestartet. Der Helper (`helper\`, Port 8787) wird nicht beendet.
- Beenden nach ca. 2 s Wartezeit bei jeder Eingabe (GetLastInputInfo), oder
  wenn der Chrome-Prozess verschwindet. Exitcode 0.
- Es werden ausschließlich Chrome-Prozesse mit dem Profil
  `FallblattUhrChrome` beendet – das normale Chrome des Nutzers bleibt unberührt.

## Deinstallieren

1. In den Bildschirmschoner-Einstellungen einen anderen Schoner wählen
   (oder „Kein“).
2. Datei `%SystemRoot%\System32\FallblattUhr.scr` bzw. die per Rechtsklick
   installierte Kopie löschen (üblicherweise unter
   `%SystemRoot%\System32\` oder im User-Profil, je nach Installationsart).
3. Optional: Chrome-Profil `%LOCALAPPDATA%\FallblattUhrChrome` löschen,
   wenn kein geteilter Timer-/Stoppuhr-Zustand mehr benötigt wird.
