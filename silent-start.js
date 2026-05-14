// Silent launcher — runs the bot in background with no visible window
// Double-click this file to start bot silently on Windows
var shell = new ActiveXObject("WScript.Shell");
shell.Run(
  'cmd /c "cd /d ' + WScript.ScriptFullName.replace('\\silent-start.js', '') + ' && node index.js > bot-log.txt 2>&1"',
  0,   // 0 = hidden window
  false
);
