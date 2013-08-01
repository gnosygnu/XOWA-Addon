Components.utils.import("resource://xowa_viewer/xowa-interface.jsm");
Components.utils.import("resource://xowa_viewer/logger.jsm");

var session = Xowa.get_session_by_id(window.XowaPageInfo.session_id);

// injected API
window.xowa_exec_async = function(/* function(result) */ _callback /* , arg1, arg2, ... */)
{
    var args = Array.prototype.slice.call(arguments, 1); // get args array without first arg
    
    session.run_xowa_cmd_async(args.join("|"), "xowa.js.exec", 
    function(_result, _result_type, _connection_status) 
    {
        switch(_connection_status)
        {
        case "EXCHANGE_END": // exchange success
            switch(_result_type)
            {
            case "xowa.js.result":
                _callback(_result);
                break;
            case "xowa.js.error":
                Logger.error("xowa_exec :: Xowa returned error "+_result+" after run "+xowa_cmd);
                break;
            }
            break;
        case "TIME_OUT": // exchange failed
        case "SERVER_NOT_RUNNING": 
        case "UNKNOWN_HOST":
        default:
            Logger("xowa_exec :: connection problem - "+_connection_status)
            break;
        }
    });  
};