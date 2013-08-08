/* 
  Copyright (c) 2013, Piotr Romaniak <piotrekrom7 at Google Gmail>
  
  This file is part of the XOWA Firefox Addon  
  
  This Source Code Form is subject to the terms of the Mozilla Public
  License, v. 2.0. If a copy of the MPL was not distributed with this
  file, You can obtain one at http://mozilla.org/MPL/2.0/.
*/

var EXPORTED_SYMBOLS = ["XowaServerProc"];

var Cc = Components.classes;
var Ci = Components.interfaces;
var Cr = Components.results;
var Cu = Components.utils;

var nsIEnvironment = Cc["@mozilla.org/process/environment;1"].getService(Ci.nsIEnvironment);
var nsIXULRuntime = Cc["@mozilla.org/xre/app-info;1"].getService(Ci.nsIXULRuntime);
var nsIObserverService = Cc["@mozilla.org/observer-service;1"].getService(Ci.nsIObserverService);
Components.utils.import("resource://xowa_viewer/logger.jsm");


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

/* class */ function XowaServerProc(_on_exit, _prefs) 
{
    this.onServerProcessExited_observer = _on_exit;
    this.prefs = _prefs;
}

XowaServerProc.prototype = 
{
    process:Cc["@mozilla.org/process/util;1"].createInstance(Ci.nsIProcess),
    onServerProcessExited: null,
    
    run: function(outbound_port, inbound_port)
    {//TODO handling xowa/java non-existense
        
        Logger.log("Starting Xowa server process");
        
        var _this = this;
        
        // get Java localization from PATH env variable
        var show_console_in_win = this.prefs.getBoolPref("debug.show_xowa_console.win");
        var java = get_java_exec_file(show_console_in_win);
        
        this.process=Cc["@mozilla.org/process/util;1"].createInstance(Ci.nsIProcess);
        this.process.init(java);
        var xowa_jar_file = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsILocalFile);
        xowa_jar_file.initWithPath(this.prefs.getCharPref("xowa_app")); 
        if( ! xowa_jar_file.exists() )
        {
            Logger.error("Cannot find xowa_<PLATFORM>.jar");
            return "JAR_NOT_EXISTS";
        }    
        
        var server_process_argv = ["-jar", xowa_jar_file.path, "--app_mode", "server", "--server_port_recv", outbound_port,  "--server_port_send", inbound_port]; // reference: https://sourceforge.net/p/xowa/tickets/160/#e689
        var xowa_user_dir = this.prefs.getCharPref("xowa_program.user_dir");
        if( xowa_user_dir !== "")
        {
            server_process_argv.push("--user_dir");
            server_process_argv.push(xowa_user_dir);
        }
        var xowa_wiki_dir = this.prefs.getCharPref("xowa_program.wiki_dir");
        if( xowa_wiki_dir !== "")
        {
            server_process_argv.push("--wiki_dir");
            server_process_argv.push(xowa_wiki_dir);
        }
        var xowa_root_dir = this.prefs.getCharPref("xowa_program.root_dir");
        if( xowa_root_dir !== "")
        {
            server_process_argv.push("--root_dir");
            server_process_argv.push(xowa_root_dir);
        }
        var xowa_cmd_file = this.prefs.getCharPref("xowa_program.cmd_file");
        if( xowa_cmd_file !== "")
        {
            server_process_argv.push("--cmd_file");
            server_process_argv.push(xowa_cmd_file);
        }
        
        this.process.runAsync(
            server_process_argv, 
            server_process_argv.length, 
            {
                observe: function(/*nsISupports aSubject*/ aProc, /*string*/ aTopic, /*wstring*/ aData)
                {
                    switch(aTopic)
                    {
                    case "process-finished":
                        Logger.log("Xowa server process exited\n"+"Return code: "+ aProc.exitValue);
                        _this.onServerProcessExited_observer.onServerProcessExited(aProc.exitValue);
                        break;
                    case "process-failed":
                        Logger.log("Xowa server process failed");
                        _this.onServerProcessExited_observer.onServerProcessExited();
                        break;
                    }
                }
            }
        );
        
        // kill process when we doesn't need it - i.e. when Firefox is closed
        nsIObserverService.addObserver(
            {
                observe: function(/*nsISupports aSubject*/ aObs, /*string*/ aTopic, /* wstring = "shutdown"|"restart" */ aData)
                {
                    if(_this.process.isRunning)
                        _this.process.kill(); //TODO: user may run complex xowa task like downloading, importing, it will be interrupted
                }
            }, 
            "quit-application", 
            false
        );
        
        return true;
    }
};