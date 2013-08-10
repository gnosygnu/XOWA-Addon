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
Components.utils.import("chrome://xowa_viewer/content/xowa-page.js");

var Cc = Components.classes;
var Ci = Components.interfaces;
var Cr = Components.results;
var Cu = Components.utils;
var nsIIOService = Cc["@mozilla.org/network/io-service;1"].getService(Ci.nsIIOService);

var kSCHEME = "xowa";
var kPROTOCOL_CONTRACTID = "@mozilla.org/network/protocol;1?name=" + kSCHEME;
var kPROTOCOL_CID = Components.ID("252ebb45-4342-4f98-9425-f2c3ecb3dbc3");

function resolve_url(_base_url, _relative_url)
{  // ugly trick but works
    var base_url_scheme = _base_url.substring(0, _base_url.indexOf(":"));
    var base_after_protocol = _base_url.substr(base_url_scheme.length+1);
    var temp_base = "http:" + (base_after_protocol.substr(0,2)=="//" ?"" :"//") + base_after_protocol;
    var baseURI = nsIIOService.newURI(temp_base, null, null);
    var temp_abs = nsIIOService.newURI(_relative_url, null, baseURI).spec;
    var absolute_url = base_url_scheme + ":" + temp_abs.substr("http:".length);
    
    return absolute_url;
} 
 

function XowaProtocol() {
}

XowaProtocol.prototype = 
{
    scheme: kSCHEME,
    defaultPort: -1,
    protocolFlags: // ref: https://developer.mozilla.org/en-US/docs/XPCOM_Interface_Reference/nsIProtocolHandler#Constants (unfortunately not precise)
        Ci.nsIProtocolHandler.URI_DANGEROUS_TO_LOAD |  // not loadable by websites, local files, only by chrome
        Ci.nsIProtocolHandler.URI_STD | 
        Ci.nsIProtocolHandler.URI_NOAUTH,

    newURI: function(aSpec, aOriginCharset, aBaseURI)
    {
        var uri = Cc["@mozilla.org/network/simple-uri;1"].createInstance(Ci.nsIURI);
        var new_url;
        if(aBaseURI === null)      
        {
            new_url = aSpec;
        }
        else 
        {
            if(aSpec.substr(0, 6) == "/site/") // urls like ""/site/home/wiki/Main Page" are absolute urls to url like "home/wiki/Main Page"
            {
                new_url = kSCHEME + "://" + aSpec.substr(6);
            }
            else if(aSpec.substr(0, 5) == "xowa:") // xowa:... means: run xowa insternal command
            {
                new_url = "xowa-cmd" + ":" + aSpec.substr(5); 
            }
            else // resolving relative -> absolute uri
            {
                new_url = resolve_url(aBaseURI.spec, aSpec);
            }
        }
        
        new_url = decodeURIComponent(new_url); // for not displaying escape sequences in status bar
        uri.spec = new_url;
        
        return uri;
    },

    newChannel: function(aURI) // function respons for content of page initiated using xowa protocol
    {
        return new XowaChannel(aURI);
    },
    classDescription: "XOWA Protocol",
    contractID: kPROTOCOL_CONTRACTID,
    classID: Components.ID(kPROTOCOL_CID),
    QueryInterface: XPCOMUtils.generateQI([Ci.nsIProtocolHandler])
};

// inspirated by: https://addons.mozilla.org/pl/firefox/files/browse/220262/file/lib/elemHideHitRegistration.js#L88
/* class */ function XowaChannel(_uri)
{
    var systemPrincipal = Cc["@mozilla.org/systemprincipal;1"].createInstance(Ci.nsIPrincipal); 
    this.owner = systemPrincipal; //TODO - there is no need to have chrome privileges
    
    this.originalURI = this.URI = _uri;
    this.xowa_resource = _uri.spec.substring(_uri.spec.indexOf(":") + 1, _uri.spec.length); // URI syntax "xowa:resource"
}

XowaChannel.prototype =
{
    xowa_resource: null,
    
    URI: null,
    originalURI: null,
    contentCharset: "UTF-8",
    contentLength: 0,
    contentType: "text/html",
    owner: null,
    securityInfo: null,
    notificationCallbacks: null,
    loadFlags: 0,
    loadGroup: null,
    name: null,
    status: Cr.NS_OK,

    asyncOpen: function(_listener, _context)
    {debugger;
        Logger.log("Protocol :: Trying get "+this.xowa_resource);
       
        var this_channel = this;
        
        _listener.onStartRequest(/* nsIRequest */ this_channel, _context);
        var session = Xowa.new_session();

        var xowa_res_escaped = this.xowa_resource.replace("'", "%27");
        var xowa_cmd = "app.shell.fetch_page('"+xowa_res_escaped+"', 'html');"; // POT. TODO: it is weak for xowa commands injections
        session.run_xowa_cmd_async("xowa.cmd.exec",xowa_cmd, 
        function(_result_type, _result , _connection_status) 
        {
            Logger.log("Protocol :: After command "+xowa_cmd+" received\n"+(_result ?_result.substr(0,100)+"[...]" :"(nothing) with status "+_connection_status));
            var page_source;
            
            switch(_connection_status)
            {
            case "EXCHANGE_END":
                switch(_result_type)
                {
                case "xowa.cmd.result":
                    page_source = _result;
                    break;
                case "xowa.cmd.error":  // TODO
                    page_source = "Xowa returned error "+_result+" after run "+xowa_cmd;
                    break;
                }
                break;
            case "TIME_OUT": //TODO
                page_source = "Connection time out.";
                break;
            case "SERVER_NOT_RUNNING": //TODO
                page_source = "Server is not running.";
                break;
            case "UNKNOWN_HOST":
                page_source = "Unknown host. Probably wrong XOWA server host is set (check extensions.xowa_viewer.xowa_server_host in about:config)";
                break;
            default:
                page_source = String(_connection_status);
                break;
            }
            
            var in_stream = Cc["@mozilla.org/io/string-input-stream;1"].createInstance(Ci.nsIStringInputStream);
            in_stream.setData(page_source, page_source.length);
            
            _listener.onDataAvailable(/* nsIRequest */ this_channel, _context, in_stream, 0, in_stream.available());
            _listener.onStopRequest(/* nsIRequest */ this_channel, _context, Cr.NS_OK);
            
            var window = this_channel._getInterface(Ci.nsIDOMWindow); // window created using this protocol
            if(window)
            {
                window.XowaPageInfo = {};
                window.XowaPageInfo.session_id = session.id;
                XowaPage.xowa_page_injection(window);
            }  
            else
            {
                Logger.log("Protocol :: Cannot get DOMWindow");
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
        catch (e) 
        {
            try
            {
                if (request.loadGroup && request.loadGroup.notificationCallbacks)
                    return request.loadGroup.notificationCallbacks.getInterface(iface);
            }
            catch (e) {}
        }
        
        return null;
    },

    /* sync */ open: function()
    {
        Logger.log("Protocol :: Called "+arguments.callee.name);
        throw Cr.NS_ERROR_NOT_IMPLEMENTED;
    },
    isPending: function()
    {
        Logger.log("Protocol :: Called "+arguments.callee.name);
        return false;
    },
    cancel: function()
    {
        Logger.log("Protocol :: Called "+arguments.callee.name);
        throw Cr.NS_ERROR_NOT_IMPLEMENTED;
    },
    suspend: function()
    {
        Logger.log("Protocol :: Called "+arguments.callee.name);
        throw Cr.NS_ERROR_NOT_IMPLEMENTED;
    },
    resume: function()
    {
        Logger.log("Protocol :: Called "+arguments.callee.name);
        throw Cr.NS_ERROR_NOT_IMPLEMENTED;
    },

    QueryInterface: XPCOMUtils.generateQI([Ci.nsIChannel, Ci.nsIRequest])
};



if (XPCOMUtils.generateNSGetFactory)
    var NSGetFactory = XPCOMUtils.generateNSGetFactory([XowaProtocol]);
else
    var NSGetModule = XPCOMUtils.generateNSGetModule([XowaProtocol]);
