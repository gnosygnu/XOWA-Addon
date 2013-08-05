set NAME=xowa_viewer@piotrex.xpi
set EXCLUDE1=*~
set EXCLUDE2=*.bak
del %NAME%
tools\7z a %NAME% .\extension\* -r -tzip -x!%EXCLUDE1% -x!%EXCLUDE2% || pause
