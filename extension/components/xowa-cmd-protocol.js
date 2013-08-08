/* 
  Copyright (c) 2013, Piotr Romaniak <piotrekrom7 at Google Gmail>
  
  This file is part of the XOWA Firefox Addon  
  
  This Source Code Form is subject to the terms of the Mozilla Public
  License, v. 2.0. If a copy of the MPL was not distributed with this
  file, You can obtain one at http://mozilla.org/MPL/2.0/.
*/

Components.utils.import("resource://gre/modules/XPCOMUtils.jsm");
Components.utils.import("resource://xowa_viewer/xowa-interface.jsm");
Components.utils.import("resource://xowa_viewer/logger.jsm");

var Cc = Components.classes;
var Ci = Components.interfaces;
var Cr = Components.results;
var Cu = Components.utils;
var nsIIOService = Cc["@mozilla.org/network/io-service;1"].getService(Ci.nsIIOService);

var kSCHEME = "xowa-cmd";
var kPROTOCOL_CONTRACTID = "@mozilla.org/network/protocol;1?name=" + kSCHEME;
var kPROTOCOL_CID = Components.ID("a7926b19-97cd-4d3d-9e86-16e38adef819");

function XowaCmdProtocol() 
{

}

XowaCmdProtocol.prototype = 
{
    scheme: kSCHEME,
    defaultPort: -1,
    protocolFlags: // I'm not sure about all below flasg
        Ci.nsIProtocolHandler.URI_INHERITS_SECURITY_CONTEXT |
        Ci.nsIProtocolHandler.URI_DANGEROUS_TO_LOAD |
        Ci.nsIProtocolHandler.URI_DOES_NOT_RETURN_DATA |
        Ci.nsIProtocolHandler.URI_NORELATIVE |
        Ci.nsIProtocolHandler.URI_OPENING_EXECUTES_SCRIPT,

    newURI: function(aSpec, aOriginCharset, aBaseURI)
    {
        var uri = Cc["@mozilla.org/network/simple-uri;1"].createInstance(Ci.nsIURI);
        uri.spec = aSpec;
        return uri;
    },

    newChannel: function(aURI) 
    {
        return new XowaCmdChannel(aURI);
    },
    classDescription: "Xowa Command Protocol",
    contractID: kPROTOCOL_CONTRACTID,
    classID: Components.ID(kPROTOCOL_CID),
    QueryInterface: XPCOMUtils.generateQI([Ci.nsIProtocolHandler])
};

/* class */ function XowaCmdChannel(_uri)
{
    var systemPrincipal = Cc["@mozilla.org/systemprincipal;1"].createInstance(Ci.nsIPrincipal); 
    this.owner = systemPrincipal; 
    
    this.originalURI = this.URI = _uri;
    this.xowa_cmd = decodeURIComponent(_uri.spec.substring(_uri.spec.indexOf(":") + 1, _uri.spec.length)); 
}



XowaCmdChannel.prototype =
{
    xowa_cmd: null,
    
    URI: null,
    originalURI: null,
    contentCharset: "UTF-8",
    contentLength: 0,
    contentType: "",
    owner: null,
    securityInfo: null,
    notificationCallbacks: null,
    loadFlags: 0,
    loadGroup: null,
    name: null,
    status: Cr.NS_OK,

    asyncOpen: function(_listener, _context)
    {// debugger;
        Logger.log("xowa-cmd protocol :: Trying run "+this.xowa_cmd);
        
        var this_channel = this;
        
        var window = this._getInterface(Ci.nsIDOMWindow); // not called _listener.onStartRequest() so coinains window on which protocol is used
        if( ! window )
        {
            Logger.error("xowa-cmd protocol :: Cannot get DOMWindow");
            return;
        }
        
        var session = Xowa.sessions[window.XowaPageInfo.session_id];
        
        session.run_xowa_cmd_async("xowa.cmd.exec",this.xowa_cmd, 
        function(_result_type, _result , _connection_status) 
        {
            var page_source;
            
            switch(_connection_status)
            {
            case "EXCHANGE_END":
                switch(_result_type)
                {
                case "xowa.cmd.result":
                    Logger.log("xowa-cmd protocol :: Xowa cmd success and returned \""+_result.substr(0,500)+"(...)\" after run \""+this_channel.xowa_cmd+"\"");
                    break;
                case "xowa.cmd.error":  // TODO
                    Logger.error("xowa-cmd protocol :: Xowa cmd returned error \""+_result+"\" after run \""+this_channel.xowa_cmd+"\"");
                    break;
                }
                break;
            case "TIME_OUT": 
            case "SERVER_NOT_RUNNING": 
            case "UNKNOWN_HOST":
            default:
                Logger.error("xowa-cmd protocol :: connection problem - "+_connection_status);
                break;
            }
        });
        
    },
    
    _getInterface :function(iface)
    {
        var request=this;
        try
        {
            if (request.notificationCallbacks)
                return request.notificationCallbacks.getInterface(iface);
        }
        catch (e) {}

        try
        {
            if (request.loadGroup && request.loadGroup.notificationCallbacks)
                return request.loadGroup.notificationCallbacks.getInterface(iface);
        }
        catch (e) {}
        
        return null;
    },

    /* sync */ open: function()
    {
        throw Cr.NS_ERROR_NOT_IMPLEMENTED;
    },
    isPending: function()
    {
        return false;
    },
    cancel: function()
    {
        throw Cr.NS_ERROR_NOT_IMPLEMENTED;
    },
    suspend: function()
    {
        throw Cr.NS_ERROR_NOT_IMPLEMENTED;
    },
    resume: function()
    {
        throw Cr.NS_ERROR_NOT_IMPLEMENTED;
    },

    QueryInterface: XPCOMUtils.generateQI([Ci.nsIChannel, Ci.nsIRequest])
};


if (XPCOMUtils.generateNSGetFactory)
    var NSGetFactory = XPCOMUtils.generateNSGetFactory([XowaCmdProtocol]);
else
    var NSGetModule = XPCOMUtils.generateNSGetModule([XowaCmdProtocol]);
