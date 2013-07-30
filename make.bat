set NAME=xowa_viewer
set EXCLUDE1=*~
set EXCLUDE2=*.bak
del %NAME%.xpi
tools\7z a %NAME%.xpi .\extension\* -r -tzip -x!%EXCLUDE1% -x!%EXCLUDE2% || pause
