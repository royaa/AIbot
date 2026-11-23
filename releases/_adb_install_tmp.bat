@echo off
"D:\Program Files\adb\adb.exe" devices -l
"D:\Program Files\adb\adb.exe" install -r "D:\wamp64_332\www\grokbot\releases\grokbot_app-1.0.0+11.apk"
echo EXIT_CODE=%ERRORLEVEL%
