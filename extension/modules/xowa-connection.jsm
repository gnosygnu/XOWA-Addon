// Definitions:
//  Exchange - in communication with Xowa: request and matching responses (one or maybe potentially more...). All communication with Xowa is series of exchanges
//  Message - request or response. Messages can be sended in message parts
//  POT. TODO - Potentially TODO

var EXPORTED_SYMBOLS = ["XowaConnection"];

var Cc = Components.classes;
var Ci = Components.interfaces;
var Cr = Components.results;
var Cu = Components.utils;

Components.utils.import("resource://xowa_viewer/logger.jsm");
Components.utils.import("resource://xowa_viewer/timer.jsm");
Components.utils.import("resource://xowa_viewer/socket.jsm");

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
    input_buffer: "",
    responses_buffer: [],
    msg_parts_delim: "|",
    requests_pending: [],
    xowa_msg_ver: "0",
    server_response_part_timeout: null,
    is_exchange:false, // there is ongoing exchange
    
    start: function(_host, _outbound_port, _inbound_port)
    {debugger;
        this.xowa_server_is_running = true; // TODO
        
        this.client_socket = new SocketClient(
            _host, 
            _outbound_port,
            /* ondataavailable this obj */ null, 
            /* function ondataavailable(data) */ null,
            /* timeout sec */ (this.prefs.getCharPref("connecting_to_xowa.timeout")/1000), // POT. TODO if addon could be work over the Internet it would be probably need set other timeouts valyues
            /* trials */ this.prefs.getCharPref("connecting_to_xowa.trials")
        );
        this.server_socket = new SocketServer(
            _inbound_port, 
            /* ondataavailable this obj */ this, 
            /* function ondataavailable(data) */ this.data_available
        );
    },
    
    close: function()
    {
        Logger.log("Closing connection to Xowa");
        if(this.input_buffer.length > 0)
        {
            this.input_buffer = "";
            Logger.log("Warning: input msg buffer wasn't empty.");
        }
        
        if(this.responses_buffer.length > 0)
        {
            this.responses_buffer = [];
            Logger.log("Warning: There was requests without responses.");
        }
        
        this.client_socket.disconnect();
        this.server_socket.disconnect();
    },
    
    send_request_async: function(_request_body, /* function(_response_body, _status) */ _callback)
    {debugger;
        var _this = this;
        var request = this.make_message(_request_body);
        
        if(this.is_exchange)
        {
            this.is_exchange = false;
            Logger.error("Last exchange isn't ended.", true); //TODO request buffer
        }
        else
        {
            this.requests_pending.push({callback: _callback});
        
            this.is_exchange = true;
            
            if( ! this.server_socket.is_listening )
                this.server_socket.listen();
            
            this.client_socket.connect(function(_status, _status2){
                switch(_status)
                {
                case "CONNECTED":
                    if(_this.is_exchange) // if not response to protocol has been sended yet.
                    {
                        _this.client_socket.send(request);
                        _this.client_socket.disconnect();
                        
                        // for waiting for response from Xowa server
                        _this.server_response_part_timeout = new Timer();
                        _this.server_response_part_timeout.setTimeout(function() { 
                            if(_this.is_exchange)
                            {
                                Logger.log("Timeout of start getting response from server");
                                _this.is_exchange = false;
                                _this.server_response_part_timeout = null;
                                _this.send_response(null, "TIME_OUT");
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
                            if(_this.is_exchange) // (exchange can be ended also by onServerProcessExited call)
                            {
                                _this.is_exchange = false;
                                _this.send_response(null, _status);
                            }
                            break;
                        }
                        break;
                    default:
                        if(_this.is_exchange) // (exchange can be ended also by onServerProcessExited call)
                        {
                            _this.is_exchange = false;
                            _this.send_response(null, _status);
                        }
                        break;
                    }
                    break;                

                }
            });
        }
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
    },
    
    onServerProcessExited: function(_exit_code)
    {// TODO automatically restart Xowa process
        this.xowa_server_is_running = false;
        if(this.is_exchange)
        {
            Logger.log("Exchange failed");
            this.is_exchange = false;
            this.send_response(null, "SERVER_NOT_RUNNING"); // it's not easy to get callback when server is properly running (I'm getting on my socket NS_ERROR_CONNECTION_REFUSED when serv. proc. not running - the same error when getting RST TCP packet from Xowa when trying connect), so it will be checked only when connection isn't success.
        }
    },
    
    send_response: function(_msg_body_arr, _status)
    {
        var matching_request = this.requests_pending.pop();
        if(matching_request === undefined)
            Logger.error("Fatal error :: There isn't pending request to sending to its response: " + JSON.stringify(_msg_body_arr) + "with status: " + _status, true);
        matching_request.callback(
            (_msg_body_arr) 
                ?_msg_body_arr 
                :this.resolve_body_msg(Array(6).join(this.msg_parts_delim)), // resolve_body_msg("|||||")
            _status
        );
    },
    
    onResponseReceived: function(msg_body)
    {
        if(this.server_response_part_timeout) // timeout timer may be running later than response (response part) is received; Then this.server_response_part_timeout is null
        {
            this.server_response_part_timeout.clearTimeout();
            this.server_response_part_timeout = null;
        }
        if(this.is_exchange) // exchange may failed before
        {
            this.is_exchange = false;
            this.send_response(this.resolve_body_msg(msg_body), "EXCHANGE_END");
        }
    },
    
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
    
    data_available: function(_raw_data) 
    {// POT. TODO : There isn't messages syntax errors handling 
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
                
                if(this.requests_pending.length === 0 && this.server_socket.is_listening)
                    this.server_socket.stop_listening();
                // stop current exchange with xowa and send to protocol
                this.onResponseReceived(msg_body);                
            }
            else // waiting for response continuation from Xowa server
            {
               if(this.server_response_part_timeout) // timeout timer may be running later than response (response part) is received; Then this.server_response_part_timeout is null
                    this.server_response_part_timeout.clearTimeout();
                else
                    this.server_response_part_timeout = new Timer();
                _this.server_response_part_timeout.setTimeout(function() { 
                    if(_this.is_exchange)
                    {
                        Logger.log("Timeout of getting response part from server");
                        _this.input_buffer = "";
                        _this.is_exchange = false;
                        _this.server_response_part_timeout = null;
                        _this.send_response(null, "TIME_OUT");
                    }
                }, _this.prefs.getCharPref("response_from_xowa.next_parts.timeout"));

                break;
            }
        }
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

