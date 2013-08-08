/* 
  Copyright (c) 2013, Piotr Romaniak <piotrekrom7 at Google Gmail>
  
  This file is part of the XOWA Firefox Addon  
  
  This Source Code Form is subject to the terms of the Mozilla Public
  License, v. 2.0. If a copy of the MPL was not distributed with this
  file, You can obtain one at http://mozilla.org/MPL/2.0/.
*/

var EXPORTED_SYMBOLS = ["Xowa"];

var Cc = Components.classes;
var Ci = Components.interfaces;
var Cr = Components.results;
var Cu = Components.utils;

var nsIPrefService = Cc["@mozilla.org/preferences-service;1"].getService(Ci.nsIPrefService);

Components.utils.import("resource://xowa_viewer/xowa-connection.jsm");
Components.utils.import("resource://xowa_viewer/logger.jsm");

var Xowa = 
{
    Interface: null, // way to communicate with Xowa - TCP Sockets
    
    /* class */ Connection : XowaConnection,
    init : function () // lazy initiate (start) 
    {    
        this.prefs = nsIPrefService.getBranch("extensions.xowa_viewer.");
        
        Logger.title = "XOWA Viewer";
        var log_path = this.prefs.getCharPref("debug.log_path");
        if(log_path !== "")
        {
            Logger.log_file_path = log_path;
            Logger.logging_to_file = true;
        }
    
        
        var outbound_port = this.prefs.getCharPref("xowa_server_port"); // default "55000";
        var inbound_port  = this.prefs.getCharPref("local_server_port"); // default "55001"; 
        var xowa_server_host = this.prefs.getCharPref("xowa_server_host"); // default 127.0.0.1

        this.Interface = new this.Connection(nsIPrefService.getBranch("extensions.xowa_viewer.xowa_connection."));
        this.Interface.init(xowa_server_host, outbound_port, inbound_port);
    },
    
    
    prefs: null,
    
    /* class */ Session : XowaSession,

    sessions: {},
    sessions_counter: 0, // number of all sessions (closed or open) and also part of name of next session (if =0 then next session id =session_0)
    new_session: function()
    {
        var id = "session_"+(this.sessions_counter);
        var session = new Xowa.Session(id);
        session.init();
        this.sessions[id] = session;
        this.sessions_counter++;
        return session;
    },
    
    end_session: function(_id)
    {
        this.sessions[id].close();
        delete this.sessions[id];
    }
};

Xowa.init();


/* class */ function XowaSession(_id)
{
    this.id = _id;
}

XowaSession.prototype = 
{
    id: null,
    init: function() { /* nothing here now */ },
    
    run_xowa_cmd_async: function(_cmd_name, _cmd,  /* function(_response_name, _response_result, _status) */ _callback)
    {
        Xowa.Interface.send_request_async(
            this.id, 
            _cmd_name,
            _cmd,
            _callback
        );
    },
    
    close: function() { /* nothing here now */ }
};
