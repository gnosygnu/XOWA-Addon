/* 
  Copyright (c) 2013, Piotr Romaniak <piotrekrom7 at Google Gmail>
  
  This file is part of the XOWA Firefox Addon  
  
  This Source Code Form is subject to the terms of the Mozilla Public
  License, v. 2.0. If a copy of the MPL was not distributed with this
  file, You can obtain one at http://mozilla.org/MPL/2.0/.
*/

// Definitions:
//  Exchange - in communication with Xowa: request and matching responses (one or maybe potentially more...). All communication with Xowa is series of exchanges
//  Message - request or response. Messages can be sended in message parts
//  POT. TODO - Potentially TODO

var EXPORTED_SYMBOLS = ["XowaConnection"];

var Cc = Components.classes;
var Ci = Components.interfaces;
var Cr = Components.results;
var Cu = Components.utils;

var nsIPrefService = Cc["@mozilla.org/preferences-service;1"].getService(Ci.nsIPrefService);
Components.utils.import("resource://xowa_viewer/logger.jsm");
Components.utils.import("resource://xowa_viewer/timer.jsm");
Components.utils.import("resource://xowa_viewer/socket.jsm");
Components.utils.import("resource://xowa_viewer/xowa-server-process.jsm");

/* class */ function XowaConnection(_config_prefs) 
// This connection is text mode, two way (using 2 sockets: server and client) 
// Now, there isn't messages pipelining (http://en.wikipedia.org/wiki/HTTP_pipelining)
{
    this.prefs = _config_prefs;
}

XowaConnection.prototype = 
{
    prefs:null,
    client_socket:null,
    server_socket:null,
    remote_server_host:null,
    local_server_port:null,
    remote_server_port:null,
    input_buffer: "",
    msg_parts_delim: "|",
    requests_pending: {},
    exchanges_counter:0,
    xowa_msg_ver: "0",
    server_response_part_timeout: null,
    is_exchange:false, // there is ongoing exchange
    
    server_process:null,
    xowa_id:"xowa_server", // Receiver id field in message
    xowa_server_is_running:false,
    established:false,
    
    init: function(_host, _outbound_port, _inbound_port)
    {
        this.remote_server_host = _host;
        this.local_server_port = _inbound_port;
        this.remote_server_port = _outbound_port;
    },
    
    start: function()
    {// debugger;
        this.server_process = new XowaServerProc(/* receiver onServerProcessExited calls */ this, nsIPrefService.getBranch("extensions.xowa_viewer."));
        var status = this.server_process.run(this.remote_server_port, this.local_server_port);
        if(status == "JAR_NOT_EXISTS")
        {
            this.established = false;
            for (var exchange_id in requests_pending)
                this.send_response(exchange_id, null, null, status);
            this.clean();
            return;
        }
        
        this.client_socket = new SocketClient(
            this.remote_server_host, 
            this.remote_server_port,
            /* ondataavailable this obj */ null, 
            /* function ondataavailable(data) */ null,
            /* timeout sec */ (this.prefs.getCharPref("connecting_to_xowa.timeout")/1000), // POT. TODO if addon could be work over the Internet it would be probably need set other timeouts valyues
            /* trials */ this.prefs.getCharPref("connecting_to_xowa.trials")
        );
        this.server_socket = new SocketServer(
            this.local_server_port, 
            /* ondataavailable this obj */ this, 
            /* function ondataavailable(data) */ this.data_available
        );
        
        this.established = true;
    },
    
    restart : function()
    {
        Logger.log("Restarting connection", true);
        this.clean();
        this.start();
    },
    
    clean: function()
    {
        Logger.log("Closing connection to Xowa");
        if(this.get_requests_pending_count() > 0)
        {
            Logger.log("Warning: No all exchanges ended.");
        }

        this.requests_pending = {};
        this.input_buffer = "";
        
        this.client_socket.disconnect();
        this.server_socket.disconnect_all();
        this.server_socket.stop_listening();
        if(this.server_process.process.isRunning)
            this.server_process.process.kill();
        this.established = false;
    },
    
    
    // function called by XowaServerProc
    onServerProcessExited: function(_exit_code)
    {// TODO automatically restart Xowa process
    debugger;
        this.xowa_server_is_running = false;
        if(this.get_requests_pending_count() > 0)
        {
            for (var exchange_id in this.requests_pending)
            {
                this.send_response(exchange_id, null, null, "SERVER_NOT_RUNNING"); // it's not easy to get callback when server is properly running (I'm getting on my socket NS_ERROR_CONNECTION_REFUSED when serv. proc. not running - the same error when getting RST TCP packet from Xowa when trying connect), so it will be checked only when connection isn't success.
            }
        }
        this.clean();
    },
       
    send_request_async: function(_session_id, _cmd_name , _cmd, /* function(_response_body, _status) */ _callback)
    {// debugger;
        var _this = this;
        var exchange_id = "msg_"+_this.exchanges_counter++;
        var request_body = _this.make_body_msg(exchange_id, _session_id, _cmd_name, _cmd);
        var message = _this.make_message(request_body);
        var exchange = {callback: _callback, server_response_timer:null, request_msg:message};
        _this.requests_pending[exchange_id]=exchange;
    
        if( ! _this.established )
        {
            _this.start();
            if( ! _this.established ) 
                return;
        }
                
        if( ! _this.server_socket.is_listening )
            _this.server_socket.listen();
        
        _this.client_socket.connect(
        function(_status, _status2)
        {
            switch(_status)
            {
            case "CONNECTED":
                if(_this.requests_pending[exchange_id] !== undefined) // if response hasn't been sended to protocol yet.
                {
                    _this.client_socket.send(message);
                    _this.client_socket.disconnect();
                    
                    // Wait for response from Xowa server
                    _this.requests_pending[exchange_id].server_response_timer = new Timer();
                    _this.requests_pending[exchange_id].server_response_timer.setTimeout(function() { 
                        if(_this.requests_pending[exchange_id] !== undefined)
                        {
                            Logger.log("Timeout of starting get response from server");
                            _this.requests_pending[exchange_id].server_response_timer = null;
                            _this.send_response(exchange_id, null, null, "TIME_OUT");
                        }
                    }, _this.prefs.getCharPref("response_from_xowa.first_part.timeout"));
                }
                break;

            case "UNKNOWN_HOST":    // a problem with connecting
            default: 
                switch(_status2)
                {
                case "TRYING_AGAIN":
                    // for now, do nothing
                    break;
                case "TRIALS_ENDED":
                    switch(_status)
                    {
                    case "TIME_OUT":
                    case "CONNECTION_REFUSED":
                    case "CONNECTION_RESET":
                    default:
                        if(_this.requests_pending[exchange_id] !== undefined) // if(exchange isn't ended already)
                        {
                            _this.send_response(exchange_id, null, null, _status);
                        }
                        break;
                    }
                    break;
                default:
                    if(_this.requests_pending[exchange_id] !== undefined) // if(exchange isn't ended already)
                    {
                        _this.send_response(exchange_id, null, null, _status);
                    }
                    break;
                }
                break;                

            }
        });
    },
    
    get_requests_pending_count :function()
    {
        return Object.getOwnPropertyNames(this.requests_pending).length;
    },
    
    onResponseReceived: function(msg_body)
    {
        var body = this.resolve_body_msg(msg_body);
        var exchange_id = body[1];
        var cmd_name = body[0];
        var cmd_text = body[5];
        this.send_response(exchange_id, cmd_name, cmd_text, "EXCHANGE_END");
        if(this.get_requests_pending_count() === 0 && this.server_socket.is_listening)
            this.server_socket.stop_listening();
    },
    
    //////////////////////////////////////////////////////   
    ///////////// Low-level IN/OUT functions /////////////
    //////////////////////////////////////////////////////  
    
    // function that is using by socket to infrom about new received data
    // when an message body is available it calls onResponseReceived with the body
    data_available: function(_raw_data) 
    {// POT. TODO : There isn't messages syntax errors handling 
    //debugger;
        var _this = this;
        
        this.input_buffer += _raw_data;
        while(true)
        {
            var delim1 = this.input_buffer.indexOf(this.msg_parts_delim, 0) ;
            if(delim1 == -1)
                break;
            var delim2 = this.input_buffer.indexOf(this.msg_parts_delim, delim1+1) ;
            if(delim2 == -1)
                break;
            var delim3 = this.input_buffer.indexOf(this.msg_parts_delim, delim2+1) ;
            if(delim3 == -1)
                break;
            
            var msg_parts = [];
            msg_parts[0] = this.input_buffer.substring(0, delim1); // ver
            msg_parts[1] = this.input_buffer.substring(delim1+1, delim2); // length
            msg_parts[2] = this.input_buffer.substring(delim2+1, delim3); // checksum
            
            var msg_length = parseInt(msg_parts[1], 10);
            var buffer_rest_length = this.input_buffer.length - (delim3+1);
            if(buffer_rest_length >= msg_length)
            {
                var msg_body = msg_parts[3] = this.input_buffer.substr(delim3+1, msg_length);
                this.input_buffer = this.input_buffer.substr(delim3+1 + msg_length);
                
                // stop current exchange with xowa and send to protocol
                this.onResponseReceived(msg_body);                
            }
            else 
            {
               break;
            }
        }
    },
    
    // Sends response to original inquirer and ends exchange
    send_response: function(_exchange_id, _cmd_name, _cmd_text, _status)
    {
        var matching_request = this.requests_pending[_exchange_id];
        if(matching_request === undefined)
            Logger.error("There isn't pending request to sending to its response: " + _cmd_name +" "+ _cmd_text + "with status: " + _status);
        else
        {
            if(matching_request.server_response_timer)
                matching_request.server_response_timer.clearTimeout();
            matching_request.callback(_cmd_name, _cmd_text, _status);
            delete this.requests_pending[_exchange_id];
        }
    },
    
    
    
    ////////////////////////////////////////////////////   
    ///////////// Messages builders/parsers /////////////
    ////////////////////////////////////////////////////   
    
    /* private */ resolve_body_msg: function(_msg_body)
    {// POT. TODO : There isn't messages syntax errors handling 
        var i;
        var delims  = new Array(6);
        delims[0] = -1;
        for (i = 1 ; i <= 5 ; i++)
            delims[i] = _msg_body.indexOf(this.msg_parts_delim, delims[i-1]+1);
            
        var msg_parts = new Array(6);
        for (i = 0; i < 6 ; i++)
            msg_parts[i] = _msg_body.substring(delims[i]+1, delims[i+1]); 
        
        return msg_parts;
    },
    
    make_body_msg : function(_exchange_id, _session_id, _cmd_name , _cmd)
    { // reference: http://sourceforge.net/p/xowa/discussion/general/thread/829fa881/#a29d
        var body_parts = Array(6);
        body_parts[0] = _cmd_name;
        body_parts[1] = _exchange_id; // Message id   TODO: pipelining (http://en.wikipedia.org/wiki/HTTP_pipelining)
        body_parts[2] = _session_id;
        body_parts[3] = this.xowa_id;
        body_parts[4] = ""; // Message date
        body_parts[5] = _cmd;        
        var body_text = body_parts.join("|");
        
        return body_text;
    },
    
    make_message: function(_body_msg)
    {
        var msg_parts = Array(4);
        msg_parts[0] = this.xowa_msg_ver;
        msg_parts[1] = prefix_zeros(_body_msg.length, 10); 
        msg_parts[2] = prefix_zeros((_body_msg.length * 2) + 1, 10); // ==> ~4.5 GB max lenght of body
        msg_parts[3] = _body_msg;
        var msg_text = msg_parts.join(this.msg_parts_delim);
        return msg_text;
    }
};

// from http://stackoverflow.com/a/1128024/1794387
function prefix_zeros(number, maxDigits) 
{  
    var length = maxDigits - number.toString().length;
    if(length <= 0)
        return number;

    var leadingZeros = new Array(length + 1);
    return leadingZeros.join('0') + number.toString();
}

