/* 
  Copyright (c) 2013, Piotr Romaniak <piotrekrom7 at Google Gmail>
  
  This file is part of the XOWA Firefox Addon  
  
  This Source Code Form is subject to the terms of the Mozilla Public
  License, v. 2.0. If a copy of the MPL was not distributed with this
  file, You can obtain one at http://mozilla.org/MPL/2.0/.
*/

var EXPORTED_SYMBOLS = ["SocketServer", "SocketClient"];

var Cc = Components.classes;
var Ci = Components.interfaces;
var Cr = Components.results;
var Cu = Components.utils;

Components.utils.import("resource://xowa_viewer/logger.jsm");
var nsISocketTransportService = Cc["@mozilla.org/network/socket-transport-service;1"].getService(Ci.nsISocketTransportService);
var nsIThreadManager = Cc["@mozilla.org/thread-manager;1"].getService(Ci.nsIThreadManager);

///////////////////////////////////////////////////////////////////
////////////////////// Class Socket ///////////////////////////////
///////////////////////////////////////////////////////////////////

// General classes to handling sockets in Firefox but not implemented features that connection with Xowa doesn't need

// Highly inspirated by mozSocket.jsm but rewritten completely (view-source:http://hg.instantbird.org/experiments/raw-file/d4326febed80/modules/mozSocket.jsm) 

// TCP Reference: http://en.wikipedia.org/wiki/Transmission_Control_Protocol

// Network errors from mozSocket.jsm
var NS_ERROR_MODULE_NETWORK = 2152398848;
var NS_ERROR_CONNECTION_REFUSED = NS_ERROR_MODULE_NETWORK + 13;
var NS_ERROR_NET_TIMEOUT = NS_ERROR_MODULE_NETWORK + 14;
var NS_ERROR_NET_RESET = NS_ERROR_MODULE_NETWORK + 20;
var NS_ERROR_UNKNOWN_HOST = NS_ERROR_MODULE_NETWORK + 30;
var NS_ERROR_UNKNOWN_PROXY_HOST = NS_ERROR_MODULE_NETWORK + 42;
var NS_ERROR_PROXY_CONNECTION_REFUSED = NS_ERROR_MODULE_NETWORK + 72;

// nsITransportEventSink status codes
var STATUS_RESOLVING       = 0x804b0003;    //Transport is resolving the host. Usually a DNS lookup.
var STATUS_RESOLVED        = 0x804b000b;    //Transport has resolved the host. Requires Gecko 6.0
var STATUS_CONNECTING_TO   = 0x804b0007;     
var STATUS_CONNECTED_TO    = 0x804b0004;     
var STATUS_SENDING_TO      = 0x804b0005;     
var STATUS_WAITING_FOR     = 0x804b000a;     
var STATUS_RECEIVING_FROM  = 0x804b0006;

/* class */ function Connection(_transport, _event_listener, _name)
{
    this.transport = _transport;
    this.observer = _event_listener;
    this.name = _name || "Socket connection";// for debug
    // observer methods and properties: /* must be implemented (may be null) */
    // onTimeOut: null,
    // onConnectionReset: null,
    // onConnectionRefused: null,
    // onUnknownHost:null,
    // onDataReceived: null,
    
    // onDataReceived_this: null,
}

Connection.prototype = 
{
    transport: null, /* contains transport.isAlive() */
   
/* private: */
    in_stream: null,
    out_stream: null,
    scriptable_in_stream: null,
    in_stream_pump: null,  

    open_streams: function() 
    {
        this.in_stream = this.transport.openInputStream(/* flags */ 0, 0, 0);
        if(!this.in_stream)
            Logger.error(this.name+" :: Error getting input stream.", true);
        this.out_stream = this.transport.openOutputStream(/* flags */ 0, 0, 0);
        if(!this.out_stream)
            Logger.error(this.name+" :: Error getting output stream.", true);
            
        this.scriptable_in_stream = Cc["@mozilla.org/scriptableinputstream;1"]
                .createInstance(Ci.nsIScriptableInputStream); // to read from in stream from js, wrap in stream into scriptable in stream  
        this.scriptable_in_stream.init(this.in_stream);
        
        this.in_stream_pump = Cc["@mozilla.org/network/input-stream-pump;1"]
                .createInstance(Ci.nsIInputStreamPump); // as I understand the pump is to allow get messages async; nsIInputStreamPump reference: http://www.oxymoronical.com/experiments/apidocs/interface/nsIInputStreamPump
        this.in_stream_pump.init(
            this.in_stream, // Data to read
            -1, // Current offset
            -1, // Read all data
            0, // Use default segment size
            0, // Use default segment length
            false  // Do not close when done
        );
        this.in_stream_pump.asyncRead(/* nsIStreamListener */ this, /* context */ this);//if(this.name=="SocketServer")debugger;
    },

    close_streams: function()
    {
        if (this.in_stream)
          this.in_stream.close();
        if (this.out_stream)
          this.out_stream.close();
    },
    
    send: function(_msg)
    {
        try 
        {   
            Logger.log(this.name+" :: Sending \""+_msg+"\"...");
            this.out_stream.write(_msg, _msg.length);
        } 
        catch(e) 
        {
            Logger.error(this.name+" :: Send message \""+_msg+"\" failed\n"+((typeof e.message !== "undefined") ?e.message :"Unknown error"), true);
        }
    },
    
    /*
    * nsIRequestObserver methods
    */
    onStartRequest: function(aRequest, aContext) 
    {
        Logger.log(this.name+" :: Called nsIRequestObserver.onStartRequest");
    },
    
    onStopRequest: function(aRequest, aContext, aStatus) 
    {//if(this.name=="SocketServer")debugger;
        Logger.log(this.name+" :: Called nsIRequestObserver.onStopRequest with status "+Logger.getMozErrorByValue(aStatus).Name);
        switch (aStatus) 
        {//TODO connection errors handling when sending/getting messages
        case NS_ERROR_NET_RESET:
            this.observer.onConnectionReset();
            break;
        case NS_ERROR_NET_TIMEOUT:
            this.observer.onTimeOut();
            break;
        case NS_ERROR_CONNECTION_REFUSED:
            this.observer.onConnectionRefused();
            break;
        case NS_ERROR_UNKNOWN_HOST: // probably trigger when used hostname (but no IP) isn't known in OS e.g. "blablabla"
            this.observer.onUnknownHost();
            break;
        }
    },
    
    disconnect : function()
    {
        this.close_streams();
    },
    
    /*
    * nsIStreamListener (inherits nsIRequestObserver) methods
    */
    onDataAvailable: function(aRequest, aContext, aInputStream, aOffset, aCount)
    { //debugger;
        var read_data = this.scriptable_in_stream.read(aCount);
        Logger.log(this.name+" :: Received \""+read_data.substr(0,500)+".......");
        if(this.observer.onDataReceived)
            this.observer.onDataReceived.call(this.observer.onDataReceived_this, read_data, this.transport.host, this.transport.port);
    }    
};


///////////////////////////////////////////////////////////////////
////////////////////// Class SocketClient /////////////////////////
///////////////////////////////////////////////////////////////////


/* class */ function SocketClient(_host, _outbound_port, _this, /* function(raw_data, host, port) */ _onDataReceived, _timeout, _connection_trials_number)
{
    this.onDataReceived = _onDataReceived;
    this.onDataReceived_this = _this;
    this.remote_host = _host;
    this.remote_port = _outbound_port; 
    this.timeout = _timeout; 
    this.connection_trials_number = _connection_trials_number; 
}

SocketClient.prototype.connecting = false; // socket is trying connecting to server
SocketClient.prototype.connection = null;
SocketClient.prototype.remote_host = null;
SocketClient.prototype.remote_port = null;
SocketClient.prototype.onConnectionStatusChange= null; /* function(status="CONNECTED"|"TIME_OUT"|"TRIALS_ENDED"|"UNKNOWN_HOST"|"CONNECTION_REFUSED"|"CONNECTION_RESET"|"ALREADY_CONNECTED", status2="TRIALS_ENDED"|"TRYING_AGAIN"|"") */
SocketClient.prototype.timeout= null; // seconds
SocketClient.prototype.connection_trials_number= null; 
SocketClient.prototype.curr_connection_trial= null; // number of current connecting trial;  1, 2, 3... when trying connecting, null otherwise


SocketClient.prototype.connect = function connect(_on_connection_status)
{// debugger;
    Logger.log("Client Socket :: Connecting to socket on " + this.remote_host + ":" + this.remote_port + "  ...");
    this.connecting = true;
    
    if(_on_connection_status)
        this.onConnectionStatusChange = _on_connection_status;
    if(this.curr_connection_trial === null) 
        this.curr_connection_trial = 1;
    else
        this.curr_connection_trial++;
    
    if(this.connection && this.connection.transport.isAlive())
    {
        Logger.error("Client Socket :: Cannot connect. Already connected to "+this.remote_host+":"+this.remote_port);
        //this.onConnectionStatusChange("ALREADY_CONNECTED", "");
        return;
    }
    
    this.transport = nsISocketTransportService.createTransport([], 0, this.remote_host, this.remote_port, null);
    this.transport.setEventSink(/* nsITransportEventSink */this, nsIThreadManager.currentThread);
    if(this.timeout) 
    {
        this.transport.setTimeout(Ci.nsISocketTransport.TIMEOUT_CONNECT, this.timeout);
        //this.transport.setTimeout(Ci.nsISocketTransport.TIMEOUT_READ_WRITE, this.timeout);
    }

    this.connection = new Connection(this.transport, /* connection problems, data received listener */ this, "SocketClient");
    this.connection.open_streams();

};

SocketClient.prototype.disconnect = function disconnect()
{
    this.connection.disconnect();
    Logger.log("Client Socket :: Disconnected from " + this.remote_host + ":" + this.remote_port);
    this.connecting = false;
};

SocketClient.prototype.send = function(_data)
{
    this.connection.send(_data);
};

SocketClient.prototype.connection_trial = function() // this.connection_trials_number has to be setted
{
    if(this.curr_connection_trial < this.connection_trials_number)
    {// Try connect again
        Logger.log(this.__proto__.constructor.name+" :: Trying connect again. Remain trials: "+(this.connection_trials_number - this.curr_connection_trial));
        this.connect(this.onConnectionStatusChange);
    }
    else
    {   
        Logger.log(this.__proto__.constructor.name+" :: Last connection failed");
        this.curr_connection_trial = null;
        this.connecting = false;
        this.onConnectionStatusChange("TRIALS_ENDED", "TRIALS_ENDED");
    }
};

// Connection observer events implementation

SocketClient.prototype.onTimeOut = function()
{
    Logger.log(this.__proto__.constructor.name+" :: Connection time out");
    
    if(this.connecting)
    {
        if(this.connection_trials_number)
        {
            this.onConnectionStatusChange("TIME_OUT", "TRYING_AGAIN");
            this.connection_trial();
        }
        else
        {
            this.connecting = false;
            this.onConnectionStatusChange("TIME_OUT", "");
        }
    }
};

SocketClient.prototype.onUnknownHost = function()
{
    Logger.log(this.__proto__.constructor.name+" :: Unknown host " + this.remote_host + ":" + this.remote_port);
    if(this.connecting)
    {
        this.connecting = false;
        this.onConnectionStatusChange("UNKNOWN_HOST", "");
    }
};

// Called when a socket request's network is reset
SocketClient.prototype.onConnectionReset = function() 
{
    Logger.log(this.__proto__.constructor.name+" :: Connection was reseted.");
    if(this.connecting)
    {
        if(this.connection_trials_number)
        {
            this.onConnectionStatusChange("CONNECTION_RESET", "TRYING_AGAIN");
            this.connection_trial();
        }
        else
        {
            this.connecting = false;
            this.onConnectionStatusChange("CONNECTION_RESET", "");
        }
    }
};

SocketClient.prototype.onConnectionRefused = function()
{
    Logger.log(this.__proto__.constructor.name+" :: Connection was refused.");
    if(this.connecting)
    {
        if(this.connection_trials_number)
        {
            this.onConnectionStatusChange("CONNECTION_REFUSED", "TRYING_AGAIN");
            this.connection_trial();
        }
        else
        {
            this.connecting = false;
            this.onConnectionStatusChange("CONNECTION_REFUSED", "");
        }
    }
};

/*
* nsITransportEventSink methods
*/
SocketClient.prototype.onTransportStatus = function(aTransport, aStatus, aProgress, aProgressmax) 
{
    // status codes : https://developer.mozilla.org/en-US/docs/XPCOM_Interface_Reference/nsISocketTransport#InterfacensITransportEventSink_status_codes.
    Logger.log(this.__proto__.constructor.name+" :: Called nsITransportEventSink.onTransportStatus with status 0x"+Number(aStatus).toString(16) + "\nData processed amount: "+aProgress);
    switch(aStatus)
    {
    case STATUS_CONNECTED_TO:
        Logger.log(this.__proto__.constructor.name+" :: Connected.");
        this.curr_connection_trial = null;
        this.connecting = false;
        this.onConnectionStatusChange("CONNECTED", "");
        break;
    }
};

///////////////////////////////////////////////////////////////////
////////////////////// Class SocketServer /////////////////////////
///////////////////////////////////////////////////////////////////

/* class */ function SocketServer(_port, _this, /* function(raw_data, host, port) */ _onDataReceived)
// Server socket allows only one connection (it stops listening after connected to a client)
{
    this.onDataReceived = _onDataReceived;
    this.onDataReceived_this = _this;
    this.local_port = _port;
    this.is_listening = false;
}

SocketServer.prototype.server_socket = null;
SocketServer.prototype.connections = [];
SocketServer.prototype.is_listening = null;

SocketServer.prototype.create_server = function() 
{
    try
    {
        Logger.log("Socket server :: Creating server on localhost:" + this.local_port);
        this.server_socket = Cc["@mozilla.org/network/server-socket;1"].createInstance(Ci.nsIServerSocket);
        this.server_socket.init(this.local_port, false, -1);
    }
    catch(e)
    {
        Logger.error("Socket server :: Creating server failed \n"+((typeof e.message !== "undefined") ?e.message :"Unknown error"), true);
    }
};

SocketServer.prototype.listen = function() 
{
    this.create_server();
    Logger.log("Socket server :: Start listening on localhost:" + this.local_port);

    try
    {
        this.server_socket.asyncListen(/* nsIServerSocketListener */ this);
        this.is_listening = true;
    }
    catch(e)
    {
        Logger.error("Socket server :: Starting listening failed \n"+((typeof e.message !== "undefined") ?e.message :"Unknown error"), true);
    }
};

// stop waiting for connection with client (doesn't affect current connection(s) if any was)
SocketServer.prototype.stop_listening = function() 
{
    Logger.log("Socket server :: Stop listening on port " + this.local_port);
    if (this.server_socket)
    {
        this.server_socket.close();
        this.is_listening = false;
    }
};

SocketServer.prototype.disconnect_all = function()
{debugger;
    for(var i=0, length=this.connections.length ; i<length ; i++)
    {
        if(this.connections[i].transport.isAlive())
            this.connections[i].disconnect();
    }
    this.connections = [];
}; 

/*
* nsIServerSocketListener methods
*/
// Called when a client connection is accepted.
SocketServer.prototype.onSocketAccepted = function (aSocket, aTransport)
{
    Logger.log("Socket Server :: Connected to "+aTransport.host+":"+aTransport.port);
    var connection = new Connection(aTransport, /* event observer */ this, "SocketServer");
    this.connections.push(connection);   // TODO clean up after disconnect (how to do ??) 
    connection.open_streams();
    this.onConnectionHeard();
};

// Called when a socket is accepted after listening.
SocketServer.prototype.onConnectionHeard = function(){};

// Called when the listening socket stops for some reason.
// The server socket is effectively dead after this notification.
SocketServer.prototype.onStopListening = function (aSocket, aStatus)
{
    Logger.log("Socket server :: Called nsIServerSocketListener.onStopListening with status "+Logger.getMozErrorByValue(aStatus).Name);
    delete this.server_socket;
};

SocketServer.prototype.onTimeOut = function(){};
SocketServer.prototype.onUnknownHost = function(){};
SocketServer.prototype.onConnectionReset = function(){};
SocketServer.prototype.onConnectionRefused = function(){};
SocketServer.prototype.onDataReceived = null;

