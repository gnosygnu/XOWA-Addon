var EXPORTED_SYMBOLS = ["Timer"];

var Cc = Components.classes;
var Ci = Components.interfaces;
var Cr = Components.results;
var Cu = Components.utils;

/* class */ function Timer()
{
    this.nsITimer = Cc["@mozilla.org/timer;1"].createInstance(Ci.nsITimer);
}

Timer.prototype = 
{
    callback:null,
    nsITimer:null,
    nsITimerCallback: null,
    callback_args: null,
    
    // nsITimerCallback method
    notify: function(_timer)
    {
        this.callback.apply("'this' object not setted", this.callback_args);
    },
    
    setTimeout: function(_callback, _delay /* , ... */)
    {
        this.callback = _callback; 
        var args = Array.prototype.slice.call(arguments); // convert arguments to array
        this.callback_args = args.slice(2);
        this.nsITimer.initWithCallback(/*nsITimerCallback*/this, _delay, Ci.nsITimer.TYPE_ONE_SHOT);
    },
    
    clearTimeout: function()
    {
        this.nsITimer.cancel();
    }
};