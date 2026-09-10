# Turning Bubbles AI into a standalone app (Windows + Linux)

You don't need C++ for this - Python has its own tool for bundling an
app into a single executable that runs without needing Python
installed: **PyInstaller**. It packages the interpreter and all
dependencies into one file/folder per platform.

Important: you build the Windows .exe *on* a Windows machine, and the
Linux binary *on* Linux - PyInstaller doesn't cross-compile. If you
only have Linux (Zorin), you can still ship the Linux build now and
build the Windows one later on any Windows PC (or a Windows VM).

## 1. Install PyInstaller

```bash
pip install pyinstaller
```

## 2. Build

From the `bubbles-ai/` folder:

```bash
pyinstaller --name "Bubbles AI" --windowed --onefile ^
  --add-data "frontend:frontend" ^
  --add-data "assets:assets" ^
  --add-data "prompts:prompts" ^
  main.py
```

(On Linux/Mac, use `:` as shown above; on Windows PowerShell/cmd, use
`;` instead of `:` in `--add-data`, e.g. `"frontend;frontend"`.)

This produces:
- Linux: `dist/Bubbles AI` (a single executable file)
- Windows: `dist/Bubbles AI.exe`

## 3. Run it

Double-click it, or from a terminal:

```bash
./dist/Bubbles\ AI
```

Your `.env` file (API keys etc.) should sit next to the executable -
Bubbles AI reads it from the working directory at startup.

## Notes

- The built app still needs internet access for cloud providers
  (OpenAI, Anthropic, etc.) - it doesn't bundle those.
- If you configured a local/offline model, that model file path still
  needs to exist on whichever machine runs the executable.
- First launch may take a couple seconds longer than `python3 main.py`
  while it unpacks itself - that's normal for `--onefile` builds.
