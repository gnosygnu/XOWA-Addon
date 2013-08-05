/* 
  Copyright (c) 2013, Piotr Romaniak <piotrekrom7 at Google Gmail>
  
  This file is part of the XOWA Firefox Addon  
  
  This Source Code Form is subject to the terms of the Mozilla Public
  License, v. 2.0. If a copy of the MPL was not distributed with this
  file, You can obtain one at http://mozilla.org/MPL/2.0/.
*/

Components.utils.import("resource://xowa_viewer/xowa-interface.jsm");
Components.utils.import("resource://xowa_viewer/logger.jsm");

var session = Xowa.sessions[window.XowaPageInfo.session_id];

// Injecting API
window.xowa_exec_async = function(/* function(result) */ _callback /* , arg1, arg2, ... */)
{
    var args = Array.prototype.slice.call(arguments, 1); // get args array without first arg (callback)
    
    // build xowa.js.exec cmd formatted like "xowa_exec('arg0', 'arg1', 'arg2');"
    var cmd = "xowa_exec(";
    for (var i = 0, args_length = args.length ; i < args_length ; i++) 
    {
        if (i !== 0) cmd += ', ';                       // delimit if not 1st arg
        cmd += "'" + args[i].replace("'", "''") + "'"; // replace apos with double-apos
    }
    cmd += ");";
    
    session.run_xowa_cmd_async(cmd, "xowa.js.exec", 
    function(_result, _result_type, _connection_status) 
    {
        switch(_connection_status)
        {
        case "EXCHANGE_END": // exchange success
            switch(_result_type)
            {
            case "xowa.js.result":
                Logger.log("xowa_exec :: Success and Xowa returned "+_result+" after run "+cmd);
                var json_result = JSON.parse(_result);
                var result = json_result.xowa_js_result;
                _callback(result);
                break;
            case "xowa.js.error":
                Logger.error("xowa_exec :: Xowa returned error "+_result+" after run "+cmd);
                break;
            }
            break;
        case "TIME_OUT": // exchange failed
        case "SERVER_NOT_RUNNING": 
        case "UNKNOWN_HOST":
        default:
            Logger.error("xowa_exec :: connection problem - "+_connection_status)
            break;
        }
    });  
};