var EXPORTED_SYMBOLS = ["Xowa"];

var Cc = Components.classes;
var Ci = Components.interfaces;
var Cr = Components.results;
var Cu = Components.utils;

var nsIEnvironment = Cc["@mozilla.org/process/environment;1"].getService(Ci.nsIEnvironment);
var nsIXULRuntime = Cc["@mozilla.org/xre/app-info;1"].getService(Ci.nsIXULRuntime);
var nsIPrefService = Cc["@mozilla.org/preferences-service;1"].getService(Ci.nsIPrefService);
var nsIObserverService = Cc["@mozilla.org/observer-service;1"].getService(Ci.nsIObserverService);

Components.utils.import("resource://xowa_viewer/xowa-connection.jsm");
Components.utils.import("resource://gre/modules/FileUtils.jsm");
Components.utils.import("resource://xowa_viewer/logger.jsm");


var Xowa = 
{
    Interface: // way to communicate with Xowa - TCP Sockets
    {// TODO merge with XowaConnection for more clearity and simplicity
    
        id: "xowa_server", // Receiver id field in message
        connection: null,
        status: "DISCONNECT",
        server_process:Cc["@mozilla.org/process/util;1"].createInstance(Ci.nsIProcess),
        /* class */ Connection : XowaConnection,
        init : function interface_init() // initiate (start) 
        {    
            var outbound_port = Xowa.prefs.getCharPref("xowa_server_port"); // default "55000";
            var inbound_port  = Xowa.prefs.getCharPref("local_server_port"); // default "55001"; 
            
            // run xowa_PLATFORM.jar with parameters to start server
            if(this.server_process.isRunning)
                this.server_process.kill();
            this.run_server(outbound_port, inbound_port);
            
            
            // establish connection on XOWA TCP Connection
            var xowa_server_host = Xowa.prefs.getCharPref("xowa_server_host"); // usually 127.0.0.1
            this.connection = new Xowa.Interface.Connection(nsIPrefService.getBranch("extensions.xowa_viewer.xowa_connection."));
            this.connection.start(xowa_server_host, outbound_port, inbound_port);
            
            this.status = "OK";
        },
        
        run_server: function(outbound_port, inbound_port)
        {//TODO handling xowa/java non-existense
        
            Logger.log("Starting Xowa server process");
            // get Java localization from PATH env variable
            var show_console_in_win = Xowa.prefs.getBoolPref("debug.show_xowa_console.win");
            var java = get_java_exec_file(show_console_in_win);
            
            this.server_process=Cc["@mozilla.org/process/util;1"].createInstance(Ci.nsIProcess);
            this.server_process.init(java);
            var xowa_jar = Xowa.prefs.getCharPref("xowa_app"); //TODO
            
            var server_process_argv = ["-jar", xowa_jar, "--app_mode", "server", "--server_port_recv", outbound_port,  "--server_port_send", inbound_port]; // reference: https://sourceforge.net/p/xowa/tickets/160/#e689
            var xowa_user_dir = Xowa.prefs.getCharPref("xowa_program.user_dir");
            if( xowa_user_dir !== "")
            {
                server_process_argv.push("--user_dir");
                server_process_argv.push(xowa_user_dir);
            }
            var xowa_wiki_dir = Xowa.prefs.getCharPref("xowa_program.wiki_dir");
            if( xowa_wiki_dir !== "")
            {
                server_process_argv.push("--wiki_dir");
                server_process_argv.push(xowa_wiki_dir);
            }
            var xowa_root_dir = Xowa.prefs.getCharPref("xowa_program.root_dir");
            if( xowa_root_dir !== "")
            {
                server_process_argv.push("--root_dir");
                server_process_argv.push(xowa_root_dir);
            }
            
            this.server_process.runAsync(server_process_argv, server_process_argv.length, this.ServerProcEndedObserver);
            
            // kill process when we doesn't need it - i.e. when Firefox is closed
            nsIObserverService.addObserver(
                this.FirefoxQuitObserver, 
                "quit-application", 
                false
            );
        },
        
        ServerProcEndedObserver : 
        {
            observe: function(/*nsISupports aSubject*/ aProc, /*string*/ aTopic, /*wstring*/ aData)
            {
                switch(aTopic)
                {
                case "process-finished":
                    // TODO
                    Logger.log("Xowa server process exited\n"+"Return code: "+ aProc.exitValue);
                    Xowa.Interface.connection.onServerProcessExited(aProc.exitValue);
                    Xowa.Interface.status = "DISCONNECT";
                    break;
                case "process-failed":
                    Logger.log("Xowa server process failed");
                    Xowa.Interface.connection.onServerProcessExited(null);
                    Xowa.Interface.status = "DISCONNECT";
                    break;
                }
            }
        },
        
        FirefoxQuitObserver:
        {
            observe: function(/*nsISupports aSubject*/ aObs, /*string*/ aTopic, /* wstring = "shutdown"|"restart" */ aData)
            {
                if(Xowa.Interface.server_process.isRunning)
                    Xowa.Interface.server_process.kill(); //TODO: user may run complex xowa task like downloading, importing, it will be interrupted
            }
        },
        
        close : function()
        {
            // close TCP Socket and XOWA server program
            if(this.server_process.isRunning)
                this.server_process.kill();
            this.connection.close();
            this.status = "DISCONNECT";
        } 
    },
    
    prefs: nsIPrefService.getBranch("extensions.xowa_viewer."),
    
    /* class */ Session : XowaSession,

    sessions: [],
    sessions_counter: 0,
    new_session: function()
    {
        this.sessions_counter++;
        var session = new Xowa.Session("session_"+this.sessions_counter);
        this.sessions.push(session);
        return session;
    },
    
    
    // msg: text sended to Xowa by Interface
    send_msg_async : function(_msg_body, /* function(_response_msg) */ _callback)
    {
        if(Xowa.Interface.status == "DISCONNECT")
            Xowa.Interface.init();
        this.Interface.connection.send_request_async(_msg_body, _callback);
    },
    
    
// private: 

    make_body_msg : function(_session_id, _cmd_name , _cmd)
    { // reference: http://sourceforge.net/p/xowa/discussion/general/thread/829fa881/#a29d
        var body_parts = Array(6);
        body_parts[0] = _cmd_name;
        body_parts[1] = ""; // Message id   TODO: pipelining (http://en.wikipedia.org/wiki/HTTP_pipelining)
        body_parts[2] = _session_id;
        body_parts[3] = Xowa.Interface.id;
        body_parts[4] = ""; // Message date
        body_parts[5] = _cmd;        
        var body_text = body_parts.join("|");
        
        return body_text;
    }
    
};

/* class */ function XowaSession(_id)
{
    this.id = _id;
}

XowaSession.prototype = 
{
    id: null,
    init: function() { /* nothing here now */ },
    
    run_xowa_cmd_async: function(_cmd, _cmd_name, /* function(_response_result, _response_name) */ _callback)
    {
        Xowa.send_msg_async(
            Xowa.make_body_msg(this.id,_cmd_name, _cmd), 
            function(_response_body_fields, _exchange_status)
            {
                // here it isn't important to me check whether session id in response matches 'this' session id. It's only important matching a response with a request, no necessary more.
                _callback(_response_body_fields[5], _response_body_fields[0], _exchange_status);
            }
        );
    },
    
    close: function() { /* nothing here now */}
};

////////////////////////////////////////////////////////////////////
//////////////////////// SUPPORT FUNCTIONS /////////////////////////
////////////////////////////////////////////////////////////////////

function get_os() // Returns "WINNT", "Linux" or "Darwin" (Mac)
{
    return nsIXULRuntime.OS;
}

function get_path_env() // returns PATH var array
{
    var path_env = nsIEnvironment.get("PATH");
    var path_env_arr = path_env.split((get_os()=="WINNT") ?";" :":");
    return path_env_arr;
}

function get_java_exec_file(_show_console_in_win)
{
    var java_filename; // source: http://wiki.eclipse.org/Eclipse.ini
    switch(get_os())
    {
        case "Darwin":
        case "Linux":
            java_filename = "java";
            break; 
        case "WINNT":
            java_filename = ((_show_console_in_win) ?"java.exe" :"javaw.exe");
            break;
    }
    
    var path_env = get_path_env();
    var potent_java_file = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsILocalFile);
    var real_java_file = null;
    for(var i=0, path_env_length=path_env.length ; i<path_env_length ; i++)
    {
        potent_java_file.initWithPath(path_env[i]);
        potent_java_file.append(java_filename);
        if(potent_java_file.exists())
        {
            real_java_file=potent_java_file;
            break;
        }
    }
    
    return real_java_file;
}


