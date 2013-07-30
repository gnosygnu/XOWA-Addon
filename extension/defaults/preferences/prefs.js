pref("extensions.xowa_viewer.xowa_app", "C:\path_to_xowa\xowa_PLATFORM.jar"); //TODO

// cmd-line parameters to xowa server program;  value "" means that param will be skipped
pref("extensions.xowa_viewer.xowa_program.user_dir", "");  
pref("extensions.xowa_viewer.xowa_program.wiki_dir", "");  
pref("extensions.xowa_viewer.xowa_program.root_dir", "");  


// All below need restart connection (e.g. kill java process) to change get effect; // TODO hook changing preferences to make changing them connection restartless
// Host and port of Xowa server to connect to it 
pref("extensions.xowa_viewer.xowa_server_host", "127.0.0.1"); 
pref("extensions.xowa_viewer.xowa_server_port", "55000"); 
pref("extensions.xowa_viewer.local_server_port", "55001"); // Port of local server to listen for connection from Xowa to get response from it ; TODO when ports are busy (in use)


pref("extensions.xowa_viewer.xowa_connection.connecting_to_xowa.timeout", "4000"); // Connecting to xowa timeout in miliseconds; 
pref("extensions.xowa_viewer.xowa_connection.connecting_to_xowa.trials", "3"); // max number of connecting to XOWA trials
pref("extensions.xowa_viewer.xowa_connection.response_from_xowa.first_part.timeout", "15000"); // Timeout of waiting for starting getting response from Xowa (getting first part of response) - in miliseconds; 
pref("extensions.xowa_viewer.xowa_connection.response_from_xowa.next_parts.timeout", "4000"); // Timeout of waiting for next parts of response from XOWA miliseconds; 
pref("extensions.xowa_viewer.debug.show_xowa_console.win", false); // Show console in Windows (in linux probably this would work --> http://www.java.com/en/download/help/enable_console_linux.xml)


