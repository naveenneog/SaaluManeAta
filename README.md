# ಸಾಲು ಮನೆ ಆಟ Saalu Mane Ata — nine men's morris (Navakankari)

The ancient nine-pebble **alignment** game, reborn as a glowing, mobile-first **3D** game. Three
nested squares, nine seeds each; **align three in a connected line** to form a mill and break a rival
seed. Reconstructed with its original intent: *foresight, planning and blocking* — **no dice**.

**Play:** place nine seeds, then move to an adjacent point; once down to three, you may **fly** to any
empty point. A **mill** (three in a straight, connected line — never a diagonal) lets you remove an
enemy seed. Reduce a rival to two, or leave them no move, to win.

**Four worlds:** `parampare` (the realistic heritage board) · `saalu` (rows of houses — original) ·
`angadi` (a marketplace — modern) · `navagraha` (the nine grahas — cosmic). Alignment read as
foresight, market power, or celestial order.

Board: 24 points, 16 mills. Vs a minimax AI or local two-player; a teaching is read aloud on each
mill, capture and win.

```bash
npm install && npm run serve   # http://localhost:5179
npm test
npm run qa
```

3D (Three.js + UnrealBloom), PWA + Android APK (Capacitor 7, JDK 21). Licence: PolyForm Noncommercial
1.0.0. Part of the Traditional Board Games suite. Built with GitHub Copilot CLI.
