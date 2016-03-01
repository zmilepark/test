/*
International Telephone Input v7.1.1
https://github.com/Bluefieldscom/intl-tel-input.git
*/
// wrap in UMD - see https://github.com/umdjs/umd/blob/master/jqueryPluginCommonjs.js
(function(factory) {
    if (typeof define === "function" && define.amd) {
        define([ "jquery" ], function($) {
            factory($, window, document);
        });
    } else if (typeof module === "object" && module.exports) {
        module.exports = factory(require("jquery"), window, document);
    } else {
        factory(jQuery, window, document);
    }
})(function($, window, document, undefined) {
    "use strict";
    // these vars persist through all instances of the plugin
    var pluginName = "intlTelInput", id = 1, // give each instance it's own id for namespaced event handling
    defaults = {
        // typing digits after a valid number will be added to the extension part of the number
        allowExtensions: false,
        // automatically format the number according to the selected country
        autoFormat: false,
        // if there is just a dial code in the input: remove it on blur, and re-add it on focus
        autoHideDialCode: true,
        // add or remove input placeholder with an example number for the selected country
        autoPlaceholder: true,
        // append menu to a specific element
        dropdownContainer: "",
        // don't display these countries
        excludeCountries: [],
        // geoIp lookup function
        geoIpLookup: null,
        // initial country
        initialCountry: "",
        // don't insert international dial codes
        nationalMode: true,
        // number type to use for placeholders
        numberType: "MOBILE",
        // display only these countries
        onlyCountries: [],
        // the countries at the top of the list. defaults to united states and united kingdom
        preferredCountries: [ "us", "gb" ],
        // specify the path to the libphonenumber script to enable validation/formatting
        utilsScript: ""
    }, keys = {
        UP: 38,
        DOWN: 40,
        ENTER: 13,
        ESC: 27,
        PLUS: 43,
        A: 65,
        Z: 90,
        ZERO: 48,
        NINE: 57,
        SPACE: 32,
        BSPACE: 8,
        TAB: 9,
        DEL: 46,
        CTRL: 17,
        CMD1: 91,
        // Chrome
        CMD2: 224
    }, windowLoaded = false;
    // keep track of if the window.load event has fired as impossible to check after the fact
    $(window).load(function() {
        windowLoaded = true;
    });
    function Plugin(element, options) {
        this.element = element;
        this.options = $.extend({}, defaults, options);
        this._defaults = defaults;
        // event namespace
        this.ns = "." + pluginName + id++;
        // Chrome, FF, Safari, IE9+
        this.isGoodBrowser = Boolean(element.setSelectionRange);
        this.hadInitialPlaceholder = Boolean($(element).attr("placeholder"));
        this._name = pluginName;
    }
    Plugin.prototype = {
        _init: function() {
            // if in nationalMode, disable options relating to dial codes
            if (this.options.nationalMode) {
                this.options.autoHideDialCode = false;
            }
            // IE Mobile doesn't support the keypress event (see issue 68) which makes autoFormat impossible
            if (navigator.userAgent.match(/IEMobile/i)) {
                this.options.autoFormat = false;
            }
            // we cannot just test screen size as some smartphones/website meta tags will report desktop resolutions
            // Note: for some reason jasmine fucks up if you put this in the main Plugin function with the rest of these declarations
            // Note: to target Android Mobiles (and not Tablets), we must find "Android" and "Mobile"
            this.isMobile = /Android.+Mobile|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
            if (this.isMobile) {
                // trigger the mobile dropdown css
                $("body").addClass("iti-mobile");
                // on mobile, we want a full screen dropdown, so we must append it to the body
                if (!this.options.dropdownContainer) {
                    this.options.dropdownContainer = "body";
                }
            }
            // we return these deferred objects from the _init() call so they can be watched, and then we resolve them when each specific request returns
            // Note: again, jasmine had a spazz when I put these in the Plugin function
            this.autoCountryDeferred = new $.Deferred();
            this.utilsScriptDeferred = new $.Deferred();
            // process all the data: onlyCountries, excludeCountries, preferredCountries etc
            this._processCountryData();
            // generate the markup
            this._generateMarkup();
            // set the initial state of the input value and the selected flag
            this._setInitialState();
            // start all of the event listeners: autoHideDialCode, input keydown, selectedFlag click
            this._initListeners();
            // utils script, and auto country
            this._initRequests();
            // return the deferreds
            return [ this.autoCountryDeferred, this.utilsScriptDeferred ];
        },
        /********************
   *  PRIVATE METHODS
   ********************/
        // prepare all of the country data, including onlyCountries, excludeCountries and preferredCountries options
        _processCountryData: function() {
            // process this instance's countries
            this._processAllCountries();
            // process the countryCodes map
            this._processCountryCodes();
            // process the preferredCountries
            this._processPreferredCountries();
        },
        // add a country code to this.countryCodes
        _addCountryCode: function(iso2, dialCode, priority) {
            if (!(dialCode in this.countryCodes)) {
                this.countryCodes[dialCode] = [];
            }
            var index = priority || 0;
            this.countryCodes[dialCode][index] = iso2;
        },
        // filter the given countries using the process function
        _filterCountries: function(countryArray, processFunc) {
            var i;
            // standardise case
            for (i = 0; i < countryArray.length; i++) {
                countryArray[i] = countryArray[i].toLowerCase();
            }
            // build instance country array
            this.countries = [];
            for (i = 0; i < allCountries.length; i++) {
                if (processFunc($.inArray(allCountries[i].iso2, countryArray))) {
                    this.countries.push(allCountries[i]);
                }
            }
        },
        // process onlyCountries or excludeCountries array if present
        _processAllCountries: function() {
            // process onlyCountries option
            if (this.options.onlyCountries.length) {
                this._filterCountries(this.options.onlyCountries, function(inArray) {
                    // if country is in array
                    return inArray != -1;
                });
            } else if (this.options.excludeCountries.length) {
                this._filterCountries(this.options.excludeCountries, function(inArray) {
                    // if country is not in array
                    return inArray == -1;
                });
            } else {
                this.countries = allCountries;
            }
        },
        // process the countryCodes map
        _processCountryCodes: function() {
            this.countryCodes = {};
            for (var i = 0; i < this.countries.length; i++) {
                var c = this.countries[i];
                this._addCountryCode(c.iso2, c.dialCode, c.priority);
                // area codes
                if (c.areaCodes) {
                    for (var j = 0; j < c.areaCodes.length; j++) {
                        // full dial code is country code + dial code
                        this._addCountryCode(c.iso2, c.dialCode + c.areaCodes[j]);
                    }
                }
            }
        },
        // process preferred countries - iterate through the preferences, fetching the country data for each one
        _processPreferredCountries: function() {
            this.preferredCountries = [];
            for (var i = 0; i < this.options.preferredCountries.length; i++) {
                var countryCode = this.options.preferredCountries[i].toLowerCase(), countryData = this._getCountryData(countryCode, false, true);
                if (countryData) {
                    this.preferredCountries.push(countryData);
                }
            }
        },
        // generate all of the markup for the plugin: the selected flag overlay, and the dropdown
        _generateMarkup: function() {
            // telephone input
            this.telInput = $(this.element);
            // prevent autocomplete as there's no safe, cross-browser event we can react to, so it can easily put the plugin in an inconsistent state e.g. the wrong flag selected for the autocompleted number, which on submit could mean the wrong number is saved (esp in nationalMode)
            this.telInput.attr("autocomplete", "off");
            // containers (mostly for positioning)
            this.telInput.wrap($("<div>", {
                "class": "intl-tel-input"
            }));
            this.flagsContainer = $("<div>", {
                "class": "flag-container"
            }).insertBefore(this.telInput);
            // currently selected flag (displayed to left of input)
            var selectedFlag = $("<div>", {
                // make element focusable and tab naviagable
                tabindex: "0",
                "class": "selected-flag"
            }).appendTo(this.flagsContainer);
            this.selectedFlagInner = $("<div>", {
                "class": "iti-flag"
            }).appendTo(selectedFlag);
            // CSS triangle
            $("<div>", {
                "class": "iti-arrow"
            }).appendTo(selectedFlag);
            // country dropdown: preferred countries, then divider, then all countries
            this.countryList = $("<ul>", {
                "class": "country-list hide"
            });
            if (this.preferredCountries.length) {
                this._appendListItems(this.preferredCountries, "preferred");
                $("<li>", {
                    "class": "divider"
                }).appendTo(this.countryList);
            }
            this._appendListItems(this.countries, "");
            // this is useful in lots of places
            this.countryListItems = this.countryList.children(".country");
            // create dropdownContainer markup
            if (this.options.dropdownContainer) {
                this.dropdown = $("<div>", {
                    "class": "intl-tel-input iti-container"
                }).append(this.countryList);
            } else {
                this.countryList.appendTo(this.flagsContainer);
            }
        },
        // add a country <li> to the countryList <ul> container
        _appendListItems: function(countries, className) {
            // we create so many DOM elements, it is faster to build a temp string
            // and then add everything to the DOM in one go at the end
            var tmp = "";
            // for each country
            for (var i = 0; i < countries.length; i++) {
                var c = countries[i];
                // open the list item
                tmp += "<li class='country " + className + "' data-dial-code='" + c.dialCode + "' data-country-code='" + c.iso2 + "'>";
                // add the flag
                tmp += "<div class='flag-box'><div class='iti-flag " + c.iso2 + "'></div></div>";
                // and the country name and dial code
                tmp += "<span class='country-name'>" + c.name + "</span>";
                tmp += "<span class='dial-code'>+" + c.dialCode + "</span>";
                // close the list item
                tmp += "</li>";
            }
            this.countryList.append(tmp);
        },
        // set the initial state of the input value and the selected flag by either extracting a dial code from the given number, or using initialCountry
        _setInitialState: function() {
            var val = this.telInput.val();
            // if we already have a dial code we can go ahead and set the flag, else fall back to default
            if (this._getDialCode(val)) {
                this._updateFlagFromNumber(val);
            } else if (this.options.initialCountry !== "auto") {
                // see if we should select a flag
                if (this.options.initialCountry) {
                    this._setFlag(this.options.initialCountry);
                } else {
                    // no dial code and no initialCountry, so default to first in list
                    this.defaultCountry = this.preferredCountries.length ? this.preferredCountries[0].iso2 : this.countries[0].iso2;
                    if (!val) {
                        this._setFlag(this.defaultCountry);
                    }
                }
                // if empty, insert the default dial code (this function will check !nationalMode and !autoHideDialCode)
                if (!val) {
                    var countryData = this._getCountryData(this.defaultCountry, false, false);
                    this._updateDialCode(countryData.dialCode, false);
                }
            }
            // NOTE: if initialCountry is set to auto, that will be handled separately
            // format
            if (val) {
                // this wont be run after _updateDialCode as that's only called if no val
                this._updateVal(val, null, false, false, false);
            }
        },
        // initialise the main event listeners: input keyup, and click selected flag
        _initListeners: function() {
            var that = this;
            this._initKeyListeners();
            // autoFormat prevents the change event from firing, so we need to check for changes between focus and blur in order to manually trigger it
            if (this.options.autoHideDialCode || this.options.autoFormat) {
                this._initFocusListeners();
            }
            // hack for input nested inside label: clicking the selected-flag to open the dropdown would then automatically trigger a 2nd click on the input which would close it again
            var label = this.telInput.closest("label");
            if (label.length) {
                label.on("click" + this.ns, function(e) {
                    // if the dropdown is closed, then focus the input, else ignore the click
                    if (that.countryList.hasClass("hide")) {
                        that.telInput.focus();
                    } else {
                        e.preventDefault();
                    }
                });
            }
            // toggle country dropdown on click
            var selectedFlag = this.selectedFlagInner.parent();
            selectedFlag.on("click" + this.ns, function(e) {
                // only intercept this event if we're opening the dropdown
                // else let it bubble up to the top ("click-off-to-close" listener)
                // we cannot just stopPropagation as it may be needed to close another instance
                if (that.countryList.hasClass("hide") && !that.telInput.prop("disabled") && !that.telInput.prop("readonly")) {
                    that._showDropdown();
                }
            });
            // open dropdown list if currently focused
            this.flagsContainer.on("keydown" + that.ns, function(e) {
                var isDropdownHidden = that.countryList.hasClass("hide");
                if (isDropdownHidden && (e.which == keys.UP || e.which == keys.DOWN || e.which == keys.SPACE || e.which == keys.ENTER)) {
                    // prevent form from being submitted if "ENTER" was pressed
                    e.preventDefault();
                    // prevent event from being handled again by document
                    e.stopPropagation();
                    that._showDropdown();
                }
                // allow navigation from dropdown to input on TAB
                if (e.which == keys.TAB) {
                    that._closeDropdown();
                }
            });
        },
        // init many requests: utils script / geo ip lookup
        _initRequests: function() {
            var that = this;
            // if the user has specified the path to the utils script, fetch it on window.load, else resolve
            if (this.options.utilsScript) {
                // if the plugin is being initialised after the window.load event has already been fired
                if (windowLoaded) {
                    $.fn[pluginName].loadUtils(this.options.utilsScript, this.utilsScriptDeferred);
                } else {
                    // wait until the load event so we don't block any other requests e.g. the flags image
                    $(window).load(function() {
                        $.fn[pluginName].loadUtils(that.options.utilsScript, that.utilsScriptDeferred);
                    });
                }
            } else {
                this.utilsScriptDeferred.resolve();
            }
            if (this.options.initialCountry === "auto") {
                this._loadAutoCountry();
            } else {
                this.autoCountryDeferred.resolve();
            }
        },
        // perform the geo ip lookup
        _loadAutoCountry: function() {
            var that = this;
            // check for cookie
            var cookieAutoCountry = window.Cookies ? Cookies.get("itiAutoCountry") : "";
            if (cookieAutoCountry) {
                $.fn[pluginName].autoCountry = cookieAutoCountry;
            }
            // 3 options:
            // 1) already loaded (we're done)
            // 2) not already started loading (start)
            // 3) already started loading (do nothing - just wait for loading callback to fire)
            if ($.fn[pluginName].autoCountry) {
                this.handleAutoCountry();
            } else if (!$.fn[pluginName].startedLoadingAutoCountry) {
                // don't do this twice!
                $.fn[pluginName].startedLoadingAutoCountry = true;
                if (typeof this.options.geoIpLookup === "function") {
                    this.options.geoIpLookup(function(countryCode) {
                        $.fn[pluginName].autoCountry = countryCode.toLowerCase();
                        if (window.Cookies) {
                            Cookies.set("itiAutoCountry", $.fn[pluginName].autoCountry, {
                                path: "/"
                            });
                        }
                        // tell all instances the auto country is ready
                        // TODO: this should just be the current instances
                        // UPDATE: use setTimeout in case their geoIpLookup function calls this callback straight away (e.g. if they have already done the geo ip lookup somewhere else). Using setTimeout means that the current thread of execution will finish before executing this, which allows the plugin to finish initialising.
                        setTimeout(function() {
                            $(".intl-tel-input input").intlTelInput("handleAutoCountry");
                        });
                    });
                }
            }
        },
        // initialize any key listeners
        _initKeyListeners: function() {
            var that = this;
            if (this.options.autoFormat) {
                // format number and update flag on keypress
                // use keypress event as we want to ignore all input except for a select few keys,
                // but we dont want to ignore the navigation keys like the arrows etc.
                // NOTE: no point in refactoring this to only bind these listeners on focus/blur because then you would need to have those 2 listeners running the whole time anyway...
                this.telInput.on("keypress" + this.ns, function(e) {
                    // 32 is space, and after that it's all chars (not meta/nav keys)
                    // this fix is needed for Firefox, which triggers keypress event for some meta/nav keys
                    // Update: also ignore if this is a metaKey e.g. FF and Safari trigger keypress on the v of Ctrl+v
                    // Update: also ignore if ctrlKey (FF on Windows/Ubuntu)
                    // Update: also check that we have utils before we do any autoFormat stuff
                    if (e.which >= keys.SPACE && !e.ctrlKey && !e.metaKey && window.intlTelInputUtils && !that.telInput.prop("readonly")) {
                        e.preventDefault();
                        // allowed keys are just numeric keys and plus
                        // we must allow plus for the case where the user does select-all and then hits plus to start typing a new number. we could refine this logic to first check that the selection contains a plus, but that wont work in old browsers, and I think it's overkill anyway
                        var isAllowedKey = e.which >= keys.ZERO && e.which <= keys.NINE || e.which == keys.PLUS, input = that.telInput[0], noSelection = that.isGoodBrowser && input.selectionStart == input.selectionEnd, max = that.telInput.attr("maxlength"), val = that.telInput.val(), // assumes that if max exists, it is >0
                        isBelowMax = max ? val.length < max : true;
                        // first: ensure we dont go over maxlength. we must do this here to prevent adding digits in the middle of the number
                        // still reformat even if not an allowed key as they could by typing a formatting char, but ignore if there's a selection as doesn't make sense to replace selection with illegal char and then immediately remove it
                        if (isBelowMax && (isAllowedKey || noSelection)) {
                            var newChar = isAllowedKey ? String.fromCharCode(e.which) : null;
                            that._handleInputKey(newChar, true, isAllowedKey);
                            // if something has changed, trigger the input event (which was otherwised squashed by the preventDefault)
                            if (val != that.telInput.val()) {
                                that.telInput.trigger("input");
                            }
                        }
                        if (!isAllowedKey) {
                            that._handleInvalidKey();
                        }
                    }
                });
            }
            // handle cut/paste event (now supported in all major browsers)
            this.telInput.on("cut" + this.ns + " paste" + this.ns, function() {
                // hack because "paste" event is fired before input is updated
                setTimeout(function() {
                    if (that.options.autoFormat && window.intlTelInputUtils) {
                        var cursorAtEnd = that.isGoodBrowser && that.telInput[0].selectionStart == that.telInput.val().length;
                        that._handleInputKey(null, cursorAtEnd, true);
                        that._ensurePlus();
                    } else {
                        // if no autoFormat, just update flag
                        that._updateFlagFromNumber(that.telInput.val());
                    }
                });
            });
            // handle keyup event
            // if autoFormat enabled: we use keyup to catch delete events (after the fact)
            // if no autoFormat, this is used to update the flag
            this.telInput.on("keyup" + this.ns, function(e) {
                // the "enter" key event from selecting a dropdown item is triggered here on the input, because the document.keydown handler that initially handles that event triggers a focus on the input, and so the keyup for that same key event gets triggered here. weird, but just make sure we dont bother doing any re-formatting in this case (we've already done preventDefault in the keydown handler, so it wont actually submit the form or anything).
                // ALSO: ignore keyup if readonly
                if (e.which == keys.ENTER || that.telInput.prop("readonly")) {} else if (that.options.autoFormat && window.intlTelInputUtils) {
                    // cursorAtEnd defaults to false for bad browsers else they would never get a reformat on delete
                    var cursorAtEnd = that.isGoodBrowser && that.telInput[0].selectionStart == that.telInput.val().length;
                    if (!that.telInput.val()) {
                        // if they just cleared the input, update the flag to the default
                        that._updateFlagFromNumber("");
                    } else if (e.which == keys.DEL && !cursorAtEnd || e.which == keys.BSPACE) {
                        // if delete in the middle: reformat with no suffix (no need to reformat if delete at end)
                        // if backspace: reformat with no suffix (need to reformat if at end to remove any lingering suffix - this is a feature)
                        // important to remember never to add suffix on any delete key as can fuck up in ie8 so you can never delete a formatting char at the end
                        that._handleInputKey(null, false, false);
                    }
                    that._ensurePlus();
                } else {
                    // if no autoFormat, just update flag
                    that._updateFlagFromNumber(that.telInput.val());
                }
            });
        },
        // prevent deleting the plus (if not in nationalMode)
        _ensurePlus: function() {
            if (!this.options.nationalMode) {
                var val = this.telInput.val(), input = this.telInput[0];
                if (val.charAt(0) != "+") {
                    // newCursorPos is current pos + 1 to account for the plus we are about to add
                    var newCursorPos = this.isGoodBrowser ? input.selectionStart + 1 : 0;
                    this.telInput.val("+" + val);
                    if (this.isGoodBrowser) {
                        input.setSelectionRange(newCursorPos, newCursorPos);
                    }
                }
            }
        },
        // alert the user to an invalid key event
        _handleInvalidKey: function() {
            var that = this;
            this.telInput.trigger("invalidkey").addClass("iti-invalid-key");
            setTimeout(function() {
                that.telInput.removeClass("iti-invalid-key");
            }, 100);
        },
        // when autoFormat is enabled: handle various key events on the input:
        // 1) adding a new number character, which will replace any selection, reformat, and preserve the cursor position
        // 2) reformatting on backspace/delete
        // 3) cut/paste event
        _handleInputKey: function(newNumericChar, addSuffix, isAllowedKey) {
            var val = this.telInput.val(), cleanBefore = this._getClean(val), originalLeftChars, // raw DOM element
            input = this.telInput[0], digitsOnRight = 0;
            if (this.isGoodBrowser) {
                // cursor strategy: maintain the number of digits on the right. we use the right instead of the left so that A) we dont have to account for the new digit (or multiple digits if paste event), and B) we're always on the right side of formatting suffixes
                digitsOnRight = this._getDigitsOnRight(val, input.selectionEnd);
                // if handling a new number character: insert it in the right place
                if (newNumericChar) {
                    // replace any selection they may have made with the new char
                    val = val.substr(0, input.selectionStart) + newNumericChar + val.substring(input.selectionEnd, val.length);
                } else {
                    // here we're not handling a new char, we're just doing a re-format (e.g. on delete/backspace/paste, after the fact), but we still need to maintain the cursor position. so make note of the char on the left, and then after the re-format, we'll count in the same number of digits from the right, and then keep going through any formatting chars until we hit the same left char that we had before.
                    // UPDATE: now have to store 2 chars as extensions formatting contains 2 spaces so you need to be able to distinguish
                    originalLeftChars = val.substr(input.selectionStart - 2, 2);
                }
            } else if (newNumericChar) {
                val += newNumericChar;
            }
            // update the number and flag
            this.setNumber(val, null, addSuffix, true, isAllowedKey);
            // update the cursor position
            if (this.isGoodBrowser) {
                var newCursor;
                val = this.telInput.val();
                // if it was at the end, keep it there
                if (!digitsOnRight) {
                    newCursor = val.length;
                } else {
                    // else count in the same number of digits from the right
                    newCursor = this._getCursorFromDigitsOnRight(val, digitsOnRight);
                    // but if delete/paste etc, keep going left until hit the same left char as before
                    if (!newNumericChar) {
                        newCursor = this._getCursorFromLeftChar(val, newCursor, originalLeftChars);
                    }
                }
                // set the new cursor
                input.setSelectionRange(newCursor, newCursor);
            }
        },
        // we start from the position in guessCursor, and work our way left until we hit the originalLeftChars or a number to make sure that after reformatting the cursor has the same char on the left in the case of a delete etc
        _getCursorFromLeftChar: function(val, guessCursor, originalLeftChars) {
            for (var i = guessCursor; i > 0; i--) {
                var leftChar = val.charAt(i - 1);
                // UPDATE: now have to store 2 chars as extensions formatting contains 2 spaces so you need to be able to distinguish
                if ($.isNumeric(leftChar) || val.substr(i - 2, 2) == originalLeftChars) {
                    return i;
                }
            }
            return 0;
        },
        // after a reformat we need to make sure there are still the same number of digits to the right of the cursor
        _getCursorFromDigitsOnRight: function(val, digitsOnRight) {
            for (var i = val.length - 1; i >= 0; i--) {
                if ($.isNumeric(val.charAt(i)) && --digitsOnRight === 0) {
                    return i;
                }
            }
            return 0;
        },
        // get the number of numeric digits to the right of the cursor so we can reposition the cursor correctly after the reformat has happened
        _getDigitsOnRight: function(val, selectionEnd) {
            var digitsOnRight = 0;
            for (var i = selectionEnd; i < val.length; i++) {
                if ($.isNumeric(val.charAt(i))) {
                    digitsOnRight++;
                }
            }
            return digitsOnRight;
        },
        // listen for focus and blur
        _initFocusListeners: function() {
            var that = this;
            if (this.options.autoHideDialCode) {
                // mousedown decides where the cursor goes, so if we're focusing we must preventDefault as we'll be inserting the dial code, and we want the cursor to be at the end no matter where they click
                this.telInput.on("mousedown" + this.ns, function(e) {
                    if (!that.telInput.is(":focus") && !that.telInput.val()) {
                        e.preventDefault();
                        // but this also cancels the focus, so we must trigger that manually
                        that.telInput.focus();
                    }
                });
            }
            this.telInput.on("focus" + this.ns, function(e) {
                var value = that.telInput.val();
                // save this to compare on blur
                that.telInput.data("focusVal", value);
                // on focus: if empty, insert the dial code for the currently selected flag
                if (that.options.autoHideDialCode && !value && !that.telInput.prop("readonly") && that.selectedCountryData.dialCode) {
                    that._updateVal("+" + that.selectedCountryData.dialCode, null, true, false, false);
                    // after auto-inserting a dial code, if the first key they hit is '+' then assume they are entering a new number, so remove the dial code. use keypress instead of keydown because keydown gets triggered for the shift key (required to hit the + key), and instead of keyup because that shows the new '+' before removing the old one
                    that.telInput.one("keypress.plus" + that.ns, function(e) {
                        if (e.which == keys.PLUS) {
                            // if autoFormat is enabled, this key event will have already have been handled by another keypress listener (hence we need to add the "+"). if disabled, it will be handled after this by a keyup listener (hence no need to add the "+").
                            var newVal = that.options.autoFormat && window.intlTelInputUtils ? "+" : "";
                            that.telInput.val(newVal);
                        }
                    });
                    // after tabbing in, make sure the cursor is at the end we must use setTimeout to get outside of the focus handler as it seems the selection happens after that
                    setTimeout(function() {
                        var input = that.telInput[0];
                        if (that.isGoodBrowser) {
                            var len = that.telInput.val().length;
                            input.setSelectionRange(len, len);
                        }
                    });
                }
            });
            this.telInput.on("blur" + this.ns, function() {
                if (that.options.autoHideDialCode) {
                    // on blur: if just a dial code then remove it
                    var value = that.telInput.val(), startsPlus = value.charAt(0) == "+";
                    if (startsPlus) {
                        var numeric = that._getNumeric(value);
                        // if just a plus, or if just a dial code
                        if (!numeric || that.selectedCountryData.dialCode == numeric) {
                            that.telInput.val("");
                        }
                    }
                    // remove the keypress listener we added on focus
                    that.telInput.off("keypress.plus" + that.ns);
                }
                // if autoFormat, we must manually trigger change event if value has changed
                if (that.options.autoFormat && window.intlTelInputUtils && that.telInput.val() != that.telInput.data("focusVal")) {
                    that.telInput.trigger("change");
                }
            });
        },
        // extract the numeric digits from the given string
        _getNumeric: function(s) {
            return s.replace(/\D/g, "");
        },
        // extract the clean number (numeric with optionally plus)
        _getClean: function(s) {
            var prefix = s.charAt(0) == "+" ? "+" : "";
            return prefix + this._getNumeric(s);
        },
        // show the dropdown
        _showDropdown: function() {
            this._setDropdownPosition();
            // update highlighting and scroll to active list item
            var activeListItem = this.countryList.children(".active");
            if (activeListItem.length) {
                this._highlightListItem(activeListItem);
                this._scrollTo(activeListItem);
            }
            // bind all the dropdown-related listeners: mouseover, click, click-off, keydown
            this._bindDropdownListeners();
            // update the arrow
            this.selectedFlagInner.children(".iti-arrow").addClass("up");
        },
        // decide where to position dropdown (depends on position within viewport, and scroll)
        _setDropdownPosition: function() {
            var that = this;
            if (this.options.dropdownContainer) {
                this.dropdown.appendTo(this.options.dropdownContainer);
            }
            // show the menu and grab the dropdown height
            this.dropdownHeight = this.countryList.removeClass("hide").outerHeight();
            if (!this.isMobile) {
                var pos = this.telInput.offset(), inputTop = pos.top, windowTop = $(window).scrollTop(), // dropdownFitsBelow = (dropdownBottom < windowBottom)
                dropdownFitsBelow = inputTop + this.telInput.outerHeight() + this.dropdownHeight < windowTop + $(window).height(), dropdownFitsAbove = inputTop - this.dropdownHeight > windowTop;
                // by default, the dropdown will be below the input. If we want to position it above the input, we add the dropup class.
                this.countryList.toggleClass("dropup", !dropdownFitsBelow && dropdownFitsAbove);
                // if dropdownContainer is enabled, calculate postion
                if (this.options.dropdownContainer) {
                    // by default the dropdown will be directly over the input because it's not in the flow. If we want to position it below, we need to add some extra top value.
                    var extraTop = !dropdownFitsBelow && dropdownFitsAbove ? 0 : this.telInput.innerHeight();
                    // calculate placement
                    this.dropdown.css({
                        top: inputTop + extraTop,
                        left: pos.left
                    });
                    // close menu on window scroll
                    $(window).on("scroll" + this.ns, function() {
                        that._closeDropdown();
                    });
                }
            }
        },
        // we only bind dropdown listeners when the dropdown is open
        _bindDropdownListeners: function() {
            var that = this;
            // when mouse over a list item, just highlight that one
            // we add the class "highlight", so if they hit "enter" we know which one to select
            this.countryList.on("mouseover" + this.ns, ".country", function(e) {
                that._highlightListItem($(this));
            });
            // listen for country selection
            this.countryList.on("click" + this.ns, ".country", function(e) {
                that._selectListItem($(this));
            });
            // click off to close
            // (except when this initial opening click is bubbling up)
            // we cannot just stopPropagation as it may be needed to close another instance
            var isOpening = true;
            $("html").on("click" + this.ns, function(e) {
                if (!isOpening) {
                    that._closeDropdown();
                }
                isOpening = false;
            });
            // listen for up/down scrolling, enter to select, or letters to jump to country name.
            // use keydown as keypress doesn't fire for non-char keys and we want to catch if they
            // just hit down and hold it to scroll down (no keyup event).
            // listen on the document because that's where key events are triggered if no input has focus
            var query = "", queryTimer = null;
            $(document).on("keydown" + this.ns, function(e) {
                // prevent down key from scrolling the whole page,
                // and enter key from submitting a form etc
                e.preventDefault();
                if (e.which == keys.UP || e.which == keys.DOWN) {
                    // up and down to navigate
                    that._handleUpDownKey(e.which);
                } else if (e.which == keys.ENTER) {
                    // enter to select
                    that._handleEnterKey();
                } else if (e.which == keys.ESC) {
                    // esc to close
                    that._closeDropdown();
                } else if (e.which >= keys.A && e.which <= keys.Z || e.which == keys.SPACE) {
                    // upper case letters (note: keyup/keydown only return upper case letters)
                    // jump to countries that start with the query string
                    if (queryTimer) {
                        clearTimeout(queryTimer);
                    }
                    query += String.fromCharCode(e.which);
                    that._searchForCountry(query);
                    // if the timer hits 1 second, reset the query
                    queryTimer = setTimeout(function() {
                        query = "";
                    }, 1e3);
                }
            });
        },
        // highlight the next/prev item in the list (and ensure it is visible)
        _handleUpDownKey: function(key) {
            var current = this.countryList.children(".highlight").first();
            var next = key == keys.UP ? current.prev() : current.next();
            if (next.length) {
                // skip the divider
                if (next.hasClass("divider")) {
                    next = key == keys.UP ? next.prev() : next.next();
                }
                this._highlightListItem(next);
                this._scrollTo(next);
            }
        },
        // select the currently highlighted item
        _handleEnterKey: function() {
            var currentCountry = this.countryList.children(".highlight").first();
            if (currentCountry.length) {
                this._selectListItem(currentCountry);
            }
        },
        // find the first list item whose name starts with the query string
        _searchForCountry: function(query) {
            for (var i = 0; i < this.countries.length; i++) {
                if (this._startsWith(this.countries[i].name, query)) {
                    var listItem = this.countryList.children("[data-country-code=" + this.countries[i].iso2 + "]").not(".preferred");
                    // update highlighting and scroll
                    this._highlightListItem(listItem);
                    this._scrollTo(listItem, true);
                    break;
                }
            }
        },
        // check if (uppercase) string a starts with string b
        _startsWith: function(a, b) {
            return a.substr(0, b.length).toUpperCase() == b;
        },
        // update the input's value to the given val
        // if autoFormat=true, format it first according to the country-specific formatting rules
        // Note: preventConversion will be false (i.e. we allow conversion) on init and when dev calls public method setNumber
        _updateVal: function(val, format, addSuffix, preventConversion, isAllowedKey) {
            var formatted;
            if (this.options.autoFormat && window.intlTelInputUtils && this.selectedCountryData) {
                if (typeof format == "number" && intlTelInputUtils.isValidNumber(val, this.selectedCountryData.iso2)) {
                    // if user specified a format, and it's a valid number, then format it accordingly
                    formatted = intlTelInputUtils.formatNumberByType(val, this.selectedCountryData.iso2, format);
                } else if (!preventConversion && this.options.nationalMode && val.charAt(0) == "+" && intlTelInputUtils.isValidNumber(val, this.selectedCountryData.iso2)) {
                    // if nationalMode and we have a valid intl number, convert it to ntl
                    formatted = intlTelInputUtils.formatNumberByType(val, this.selectedCountryData.iso2, intlTelInputUtils.numberFormat.NATIONAL);
                } else {
                    // else do the regular AsYouType formatting
                    formatted = intlTelInputUtils.formatNumber(val, this.selectedCountryData.iso2, addSuffix, this.options.allowExtensions, isAllowedKey);
                }
                // ensure we dont go over maxlength. we must do this here to truncate any formatting suffix, and also handle paste events
                var max = this.telInput.attr("maxlength");
                if (max && formatted.length > max) {
                    formatted = formatted.substr(0, max);
                }
            } else {
                // no autoFormat, so just insert the original value
                formatted = val;
            }
            this.telInput.val(formatted);
        },
        // check if need to select a new flag based on the given number
        _updateFlagFromNumber: function(number) {
            // if we're in nationalMode and we already have US/Canada selected, make sure the number starts with a +1 so _getDialCode will be able to extract the area code
            // update: if we dont yet have selectedCountryData, but we're here (trying to update the flag from the number), that means we're initialising the plugin with a number that already has a dial code, so fine to ignore this bit
            if (number && this.options.nationalMode && this.selectedCountryData && this.selectedCountryData.dialCode == "1" && number.charAt(0) != "+") {
                if (number.charAt(0) != "1") {
                    number = "1" + number;
                }
                number = "+" + number;
            }
            // try and extract valid dial code from input
            var dialCode = this._getDialCode(number), countryCode = null;
            if (dialCode) {
                // check if one of the matching countries is already selected
                var countryCodes = this.countryCodes[this._getNumeric(dialCode)], alreadySelected = this.selectedCountryData && $.inArray(this.selectedCountryData.iso2, countryCodes) != -1;
                // if a matching country is not already selected (or this is an unknown NANP area code): choose the first in the list
                if (!alreadySelected || this._isUnknownNanp(number, dialCode)) {
                    // if using onlyCountries option, countryCodes[0] may be empty, so we must find the first non-empty index
                    for (var j = 0; j < countryCodes.length; j++) {
                        if (countryCodes[j]) {
                            countryCode = countryCodes[j];
                            break;
                        }
                    }
                }
            } else if (number.charAt(0) == "+" && this._getNumeric(number).length) {
                // invalid dial code, so empty
                // Note: use getNumeric here because the number has not been formatted yet, so could contain bad shit
                countryCode = "";
            } else if (!number || number == "+") {
                // empty, or just a plus, so default
                countryCode = this.defaultCountry;
            }
            if (countryCode !== null) {
                this._setFlag(countryCode);
            }
        },
        // check if the given number contains an unknown area code from the North American Numbering Plan i.e. the only dialCode that could be extracted was +1 (instead of say +1 702) and the actual number's length is >=4
        _isUnknownNanp: function(number, dialCode) {
            return dialCode == "+1" && this._getNumeric(number).length >= 4;
        },
        // remove highlighting from other list items and highlight the given item
        _highlightListItem: function(listItem) {
            this.countryListItems.removeClass("highlight");
            listItem.addClass("highlight");
        },
        // find the country data for the given country code
        // the ignoreOnlyCountriesOption is only used during init() while parsing the onlyCountries array
        _getCountryData: function(countryCode, ignoreOnlyCountriesOption, allowFail) {
            var countryList = ignoreOnlyCountriesOption ? allCountries : this.countries;
            for (var i = 0; i < countryList.length; i++) {
                if (countryList[i].iso2 == countryCode) {
                    return countryList[i];
                }
            }
            if (allowFail) {
                return null;
            } else {
                throw new Error("No country data for '" + countryCode + "'");
            }
        },
        // select the given flag, update the placeholder and the active list item
        _setFlag: function(countryCode) {
            // do this first as it will throw an error and stop if countryCode is invalid
            this.selectedCountryData = countryCode ? this._getCountryData(countryCode, false, false) : {};
            // update the defaultCountry - we only need the iso2 from now on, so just store that
            if (this.selectedCountryData.iso2) {
                // can't just make this equal to selectedCountryData as would be a ref to that object
                this.defaultCountry = this.selectedCountryData.iso2;
            }
            this.selectedFlagInner.attr("class", "iti-flag " + countryCode);
            // update the selected country's title attribute
            var title = countryCode ? this.selectedCountryData.name + ": +" + this.selectedCountryData.dialCode : "Unknown";
            this.selectedFlagInner.parent().attr("title", title);
            // and the input's placeholder
            this._updatePlaceholder();
            // update the active list item
            this.countryListItems.removeClass("active");
            if (countryCode) {
                this.countryListItems.find(".iti-flag." + countryCode).first().closest(".country").addClass("active");
            }
        },
        // update the input placeholder to an example number from the currently selected country
        _updatePlaceholder: function() {
            if (window.intlTelInputUtils && !this.hadInitialPlaceholder && this.options.autoPlaceholder && this.selectedCountryData) {
                var iso2 = this.selectedCountryData.iso2, numberType = intlTelInputUtils.numberType[this.options.numberType], placeholder = iso2 ? intlTelInputUtils.getExampleNumber(iso2, this.options.nationalMode, numberType) : "";
                if (typeof this.options.customPlaceholder === "function") {
                    placeholder = this.options.customPlaceholder(placeholder, this.selectedCountryData);
                }
                this.telInput.attr("placeholder", placeholder);
            }
        },
        // called when the user selects a list item from the dropdown
        _selectListItem: function(listItem) {
            // update selected flag and active list item
            this._setFlag(listItem.attr("data-country-code"));
            this._closeDropdown();
            this._updateDialCode(listItem.attr("data-dial-code"), true);
            // trigger a custom event as even in nationalMode the state has changed
            this.telInput.trigger("country-change");
            // focus the input
            this.telInput.focus();
            // fix for FF and IE11 (with nationalMode=false i.e. auto inserting dial code), who try to put the cursor at the beginning the first time
            if (this.isGoodBrowser) {
                var len = this.telInput.val().length;
                this.telInput[0].setSelectionRange(len, len);
            }
        },
        // close the dropdown and unbind any listeners
        _closeDropdown: function() {
            this.countryList.addClass("hide");
            // update the arrow
            this.selectedFlagInner.children(".iti-arrow").removeClass("up");
            // unbind key events
            $(document).off(this.ns);
            // unbind click-off-to-close
            $("html").off(this.ns);
            // unbind hover and click listeners
            this.countryList.off(this.ns);
            // remove menu from container
            if (this.options.dropdownContainer) {
                if (!this.isMobile) {
                    $(window).off("scroll" + this.ns);
                }
                this.dropdown.detach();
            }
        },
        // check if an element is visible within it's container, else scroll until it is
        _scrollTo: function(element, middle) {
            var container = this.countryList, containerHeight = container.height(), containerTop = container.offset().top, containerBottom = containerTop + containerHeight, elementHeight = element.outerHeight(), elementTop = element.offset().top, elementBottom = elementTop + elementHeight, newScrollTop = elementTop - containerTop + container.scrollTop(), middleOffset = containerHeight / 2 - elementHeight / 2;
            if (elementTop < containerTop) {
                // scroll up
                if (middle) {
                    newScrollTop -= middleOffset;
                }
                container.scrollTop(newScrollTop);
            } else if (elementBottom > containerBottom) {
                // scroll down
                if (middle) {
                    newScrollTop += middleOffset;
                }
                var heightDifference = containerHeight - elementHeight;
                container.scrollTop(newScrollTop - heightDifference);
            }
        },
        // replace any existing dial code with the new one (if not in nationalMode)
        // also we need to know if we're focusing for a couple of reasons e.g. if so, we want to add any formatting suffix, also if the input is empty and we're not in nationalMode, then we want to insert the dial code
        _updateDialCode: function(newDialCode, focusing) {
            var inputVal = this.telInput.val(), newNumber;
            // save having to pass this every time
            newDialCode = "+" + newDialCode;
            if (this.options.nationalMode && inputVal.charAt(0) != "+") {
                // if nationalMode, we just want to re-format
                newNumber = inputVal;
            } else if (inputVal) {
                // if the previous number contained a valid dial code, replace it
                // (if more than just a plus character)
                var prevDialCode = this._getDialCode(inputVal);
                if (prevDialCode.length > 1) {
                    newNumber = inputVal.replace(prevDialCode, newDialCode);
                } else {
                    // if the previous number didn't contain a dial code, we should persist it
                    var existingNumber = inputVal.charAt(0) != "+" ? $.trim(inputVal) : "";
                    newNumber = newDialCode + existingNumber;
                }
            } else {
                newNumber = !this.options.autoHideDialCode || focusing ? newDialCode : "";
            }
            this._updateVal(newNumber, null, focusing, false, false);
        },
        // try and extract a valid international dial code from a full telephone number
        // Note: returns the raw string inc plus character and any whitespace/dots etc
        _getDialCode: function(number) {
            var dialCode = "";
            // only interested in international numbers (starting with a plus)
            if (number.charAt(0) == "+") {
                var numericChars = "";
                // iterate over chars
                for (var i = 0; i < number.length; i++) {
                    var c = number.charAt(i);
                    // if char is number
                    if ($.isNumeric(c)) {
                        numericChars += c;
                        // if current numericChars make a valid dial code
                        if (this.countryCodes[numericChars]) {
                            // store the actual raw string (useful for matching later)
                            dialCode = number.substr(0, i + 1);
                        }
                        // longest dial code is 4 chars
                        if (numericChars.length == 4) {
                            break;
                        }
                    }
                }
            }
            return dialCode;
        },
        /********************
   *  PUBLIC METHODS
   ********************/
        // this is called when the geoip call returns
        handleAutoCountry: function() {
            if (this.options.initialCountry === "auto") {
                // we must set this even if there is an initial val in the input: in case the initial val is invalid and they delete it - they should see their auto country
                this.defaultCountry = $.fn[pluginName].autoCountry;
                // if there's no initial value in the input, then update the flag
                if (!this.telInput.val()) {
                    this.setCountry(this.defaultCountry);
                }
                this.autoCountryDeferred.resolve();
            }
        },
        // remove plugin
        destroy: function() {
            // make sure the dropdown is closed (and unbind listeners)
            this._closeDropdown();
            // key events, and focus/blur events if autoHideDialCode=true
            this.telInput.off(this.ns);
            // click event to open dropdown
            this.selectedFlagInner.parent().off(this.ns);
            // label click hack
            this.telInput.closest("label").off(this.ns);
            // remove markup
            var container = this.telInput.parent();
            container.before(this.telInput).remove();
        },
        // extract the phone number extension if present
        getExtension: function() {
            return this.telInput.val().split(" ext. ")[1] || "";
        },
        // format the number to the given type
        getNumber: function(type) {
            if (window.intlTelInputUtils) {
                return intlTelInputUtils.formatNumberByType(this.telInput.val(), this.selectedCountryData.iso2, type);
            }
            return "";
        },
        // get the type of the entered number e.g. landline/mobile
        getNumberType: function() {
            if (window.intlTelInputUtils) {
                return intlTelInputUtils.getNumberType(this.telInput.val(), this.selectedCountryData.iso2);
            }
            return -99;
        },
        // get the country data for the currently selected flag
        getSelectedCountryData: function() {
            // if this is undefined, the plugin will return it's instance instead, so in that case an empty object makes more sense
            return this.selectedCountryData || {};
        },
        // get the validation error
        getValidationError: function() {
            if (window.intlTelInputUtils) {
                return intlTelInputUtils.getValidationError(this.telInput.val(), this.selectedCountryData.iso2);
            }
            return -99;
        },
        // validate the input val - assumes the global function isValidNumber (from utilsScript)
        isValidNumber: function() {
            var val = $.trim(this.telInput.val()), countryCode = this.options.nationalMode ? this.selectedCountryData.iso2 : "";
            if (window.intlTelInputUtils) {
                return intlTelInputUtils.isValidNumber(val, countryCode);
            }
            return false;
        },
        // update the selected flag, and update the input val accordingly ()
        setCountry: function(countryCode) {
            countryCode = countryCode.toLowerCase();
            // check if already selected
            if (!this.selectedFlagInner.hasClass(countryCode)) {
                this._setFlag(countryCode);
                this._updateDialCode(this.selectedCountryData.dialCode, false);
            }
        },
        // set the input value and update the flag
        // NOTE: format arg is for public method: to allow devs to format how they want
        setNumber: function(number, format, addSuffix, preventConversion, isAllowedKey) {
            // ensure starts with plus
            if (!this.options.nationalMode && number.charAt(0) != "+") {
                number = "+" + number;
            }
            // we must update the flag first, which updates this.selectedCountryData, which is used later for formatting the number before displaying it
            this._updateFlagFromNumber(number);
            this._updateVal(number, format, addSuffix, preventConversion, isAllowedKey);
        },
        // this is called when the utils request completes
        handleUtils: function() {
            // if the request was successful
            if (window.intlTelInputUtils) {
                // if autoFormat is enabled and there's an initial value in the input, then format it
                if (this.options.autoFormat && this.telInput.val()) {
                    this._updateVal(this.telInput.val(), null, false, false, false);
                }
                this._updatePlaceholder();
            }
            this.utilsScriptDeferred.resolve();
        }
    };
    // using https://github.com/jquery-boilerplate/jquery-boilerplate/wiki/Extending-jQuery-Boilerplate
    // (adapted to allow public functions)
    $.fn[pluginName] = function(options) {
        var args = arguments;
        // Is the first parameter an object (options), or was omitted,
        // instantiate a new instance of the plugin.
        if (options === undefined || typeof options === "object") {
            var deferreds = [];
            this.each(function() {
                if (!$.data(this, "plugin_" + pluginName)) {
                    var instance = new Plugin(this, options);
                    var instanceDeferreds = instance._init();
                    // we now have 2 deffereds: 1 for auto country, 1 for utils script
                    deferreds.push(instanceDeferreds[0]);
                    deferreds.push(instanceDeferreds[1]);
                    $.data(this, "plugin_" + pluginName, instance);
                }
            });
            // return the promise from the "master" deferred object that tracks all the others
            return $.when.apply(null, deferreds);
        } else if (typeof options === "string" && options[0] !== "_") {
            // If the first parameter is a string and it doesn't start
            // with an underscore or "contains" the `init`-function,
            // treat this as a call to a public method.
            // Cache the method call to make it possible to return a value
            var returns;
            this.each(function() {
                var instance = $.data(this, "plugin_" + pluginName);
                // Tests that there's already a plugin-instance
                // and checks that the requested public method exists
                if (instance instanceof Plugin && typeof instance[options] === "function") {
                    // Call the method of our plugin instance,
                    // and pass it the supplied arguments.
                    returns = instance[options].apply(instance, Array.prototype.slice.call(args, 1));
                }
                // Allow instances to be destroyed via the 'destroy' method
                if (options === "destroy") {
                    $.data(this, "plugin_" + pluginName, null);
                }
            });
            // If the earlier cached method gives a value back return the value,
            // otherwise return this to preserve chainability.
            return returns !== undefined ? returns : this;
        }
    };
    /********************
 *  STATIC METHODS
 ********************/
    // get the country data object
    $.fn[pluginName].getCountryData = function() {
        return allCountries;
    };
    // load the utils script
    $.fn[pluginName].loadUtils = function(path, utilsScriptDeferred) {
        if (!$.fn[pluginName].loadedUtilsScript) {
            // don't do this twice! (dont just check if window.intlTelInputUtils exists as if init plugin multiple times in quick succession, it may not have finished loading yet)
            $.fn[pluginName].loadedUtilsScript = true;
            // dont use $.getScript as it prevents caching
            $.ajax({
                url: path,
                complete: function() {
                    // tell all instances that the utils request is complete
                    $(".intl-tel-input input").intlTelInput("handleUtils");
                },
                dataType: "script",
                cache: true
            });
        } else if (utilsScriptDeferred) {
            utilsScriptDeferred.resolve();
        }
    };
    // version
    $.fn[pluginName].version = "7.1.1";
    // Tell JSHint to ignore this warning: "character may get silently deleted by one or more browsers"
    // jshint -W100
    // Array of country objects for the flag dropdown.
    // Each contains a name, country code (ISO 3166-1 alpha-2) and dial code.
    // Originally from https://github.com/mledoze/countries
    // then with a couple of manual re-arrangements to be alphabetical
    // then changed Kazakhstan from +76 to +7
    // and Vatican City from +379 to +39 (see issue 50)
    // and Caribean Netherlands from +5997 to +599
    // and Curacao from +5999 to +599
    // Removed:  Kosovo, Pitcairn Islands, South Georgia
    // UPDATE Sept 12th 2015
    // List of regions that have iso2 country codes, which I have chosen to omit:
    // (based on this information: https://en.wikipedia.org/wiki/List_of_country_calling_codes)
    // AQ - Antarctica - all different country codes depending on which "base"
    // BV - Bouvet Island - no calling code
    // GS - South Georgia and the South Sandwich Islands - "inhospitable collection of islands" - same flag and calling code as Falkland Islands
    // HM - Heard Island and McDonald Islands - no calling code
    // PN - Pitcairn - tiny population (56), same calling code as New Zealand
    // TF - French Southern Territories - no calling code
    // UM - United States Minor Outlying Islands - no calling code
    // UPDATE the criteria of supported countries or territories (see issue 297)
    // Have an iso2 code: https://en.wikipedia.org/wiki/ISO_3166-1_alpha-2
    // Have a country calling code: https://en.wikipedia.org/wiki/List_of_country_calling_codes
    // Have a flag
    // Must be supported by libphonenumber: https://github.com/googlei18n/libphonenumber
    // Update: converted objects to arrays to save bytes!
    // Update: added "priority" for countries with the same dialCode as others
    // Update: added array of area codes for countries with the same dialCode as others
    // So each country array has the following information:
    // [
    //    Country name,
    //    iso2 code,
    //    International dial code,
    //    Order (if >1 country with same dial code),
    //    Area codes (if >1 country with same dial code)
    // ]

    /********************
     *  TR-CUSTOMIZED METHOD
     ********************/

    function transformCountryData(data) {
    	var countryList = [];
    	for (var i = 0; i < data.length; i++) {
            var c = data[i];
            countryList[i] = {
                name: c[0],
                iso2: c[1],
                dialCode: c[2],
                priority: c[3] || 0,
                areaCodes: c[4] || null
            };
        }
    	return countryList;
    }

    $.fn[pluginName].setLocale = function(locale) {
    	var effectiveLocale = (locale && (locale in countryInfo))? locale : 'en-US';
		  allCountries = transformCountryData(countryInfo[effectiveLocale]);
    };

    // $.ajax({
    //     url: "country.properties",
    //     async: false,
    //     success: function (data) {
    //       console.log('==== .properties ====');
    //         console.log(data);
    //     }
    // });

    var countryInfo = {
    	'en-US': [ ["Afghanistan", "af", "93"], ["Albania", "al", "355"], ["Algeria", "dz", "213"], ["American Samoa", "as", "1684"], ["Andorra", "ad", "376"], ["Angola", "ao", "244"], ["Anguilla", "ai", "1264"], ["Antigua and Barbuda", "ag", "1268"], ["Argentina", "ar", "54"], ["Armenia", "am", "374"], ["Aruba", "aw", "297"], ["Australia", "au", "61", 0], ["Austria", "at", "43"], ["Azerbaijan", "az", "994"], ["Bahamas", "bs", "1242"], ["Bahrain", "bh", "973"], ["Bangladesh", "bd", "880"], ["Barbados", "bb", "1246"], ["Belarus", "by", "375"], ["Belgium", "be", "32"], ["Belize", "bz", "501"], ["Benin", "bj", "229"], ["Bermuda", "bm", "1441"], ["Bhutan", "bt", "975"], ["Bolivia", "bo", "591"], ["Bosnia and Herzegovina", "ba", "387"], ["Botswana", "bw", "267"], ["Brazil", "br", "55"], ["British Indian Ocean Territory", "io", "246"], ["British Virgin Islands", "vg", "1284"], ["Brunei", "bn", "673"], ["Bulgaria", "bg", "359"], ["Burkina Faso", "bf", "226"], ["Burundi", "bi", "257"], ["Cambodia", "kh", "855"], ["Cameroon", "cm", "237"], ["Canada", "ca", "1", 1, ["204", "226", "236", "249", "250", "289", "306", "343", "365", "387", "403", "416", "418", "431", "437", "438", "450", "506", "514", "519", "548", "579", "581", "587", "604", "613", "639", "647", "672", "705", "709", "742", "778", "780", "782", "807", "819", "825", "867", "873", "902", "905"]], ["Cape Verde", "cv", "238"], ["Caribbean Netherlands", "bq", "599", 1], ["Cayman Islands", "ky", "1345"], ["Central African Republic", "cf", "236"], ["Chad", "td", "235"], ["Chile", "cl", "56"], ["China", "cn", "86"], ["Christmas Island", "cx", "61", 2], ["Cocos (Keeling) Islands", "cc", "61", 1], ["Colombia", "co", "57"], ["Comoros", "km", "269"], ["Congo (DRC)", "cd", "243"], ["Congo (Republic)", "cg", "242"], ["Cook Islands", "ck", "682"], ["Costa Rica", "cr", "506"], ["Côte d’Ivoire", "ci", "225"], ["Croatia", "hr", "385"], ["Cuba", "cu", "53"], ["Curaçao", "cw", "599", 0], ["Cyprus", "cy", "357"], ["Czech Republic", "cz", "420"], ["Denmark", "dk", "45"], ["Djibouti", "dj", "253"], ["Dominica", "dm", "1767"], ["Dominican Republic", "do", "1", 2, ["809", "829", "849"]], ["Ecuador", "ec", "593"], ["Egypt", "eg", "20"], ["El Salvador", "sv", "503"], ["Equatorial Guinea", "gq", "240"], ["Eritrea", "er", "291"], ["Estonia", "ee", "372"], ["Ethiopia", "et", "251"], ["Falkland Islands", "fk", "500"], ["Faroe Islands", "fo", "298"], ["Fiji", "fj", "679"], ["Finland", "fi", "358", 0], ["France", "fr", "33"], ["French Guiana", "gf", "594"], ["French Polynesia", "pf", "689"], ["Gabon", "ga", "241"], ["Gambia", "gm", "220"], ["Georgia", "ge", "995"], ["Germany", "de", "49"], ["Ghana", "gh", "233"], ["Gibraltar", "gi", "350"], ["Greece", "gr", "30"], ["Greenland", "gl", "299"], ["Grenada", "gd", "1473"], ["Guadeloupe", "gp", "590", 0], ["Guam", "gu", "1671"], ["Guatemala", "gt", "502"], ["Guernsey", "gg", "44", 1], ["Guinea", "gn", "224"], ["Guinea-Bissau", "gw", "245"], ["Guyana", "gy", "592"], ["Haiti", "ht", "509"], ["Honduras", "hn", "504"], ["Hong Kong", "hk", "852"], ["Hungary", "hu", "36"], ["Iceland", "is", "354"], ["India", "in", "91"], ["Indonesia", "id", "62"], ["Iran", "ir", "98"], ["Iraq", "iq", "964"], ["Ireland", "ie", "353"], ["Isle of Man", "im", "44", 2], ["Israel", "il", "972"], ["Italy", "it", "39", 0], ["Jamaica", "jm", "1876"], ["Japan", "jp", "81"], ["Jersey", "je", "44", 3], ["Jordan", "jo", "962"], ["Kazakhstan", "kz", "7", 1], ["Kenya", "ke", "254"], ["Kiribati", "ki", "686"], ["Kuwait", "kw", "965"], ["Kyrgyzstan", "kg", "996"], ["Laos", "la", "856"], ["Latvia", "lv", "371"], ["Lebanon", "lb", "961"], ["Lesotho", "ls", "266"], ["Liberia", "lr", "231"], ["Libya", "ly", "218"], ["Liechtenstein", "li", "423"], ["Lithuania", "lt", "370"], ["Luxembourg", "lu", "352"], ["Macau", "mo", "853"], ["Macedonia (FYROM)", "mk", "389"], ["Madagascar", "mg", "261"], ["Malawi", "mw", "265"], ["Malaysia", "my", "60"], ["Maldives", "mv", "960"], ["Mali", "ml", "223"], ["Malta", "mt", "356"], ["Marshall Islands", "mh", "692"], ["Martinique", "mq", "596"], ["Mauritania", "mr", "222"], ["Mauritius", "mu", "230"], ["Mayotte", "yt", "262", 1], ["Mexico", "mx", "52"], ["Micronesia", "fm", "691"], ["Moldova", "md", "373"], ["Monaco", "mc", "377"], ["Mongolia", "mn", "976"], ["Montenegro", "me", "382"], ["Montserrat", "ms", "1664"], ["Morocco", "ma", "212", 0], ["Mozambique", "mz", "258"], ["Myanmar", "mm", "95"], ["Namibia", "na", "264"], ["Nauru", "nr", "674"], ["Nepal", "np", "977"], ["Netherlands", "nl", "31"], ["New Caledonia", "nc", "687"], ["New Zealand", "nz", "64"], ["Nicaragua", "ni", "505"], ["Niger", "ne", "227"], ["Nigeria", "ng", "234"], ["Niue", "nu", "683"], ["Norfolk Island", "nf", "672"], ["North Korea", "kp", "850"], ["Northern Mariana Islands", "mp", "1670"], ["Norway", "no", "47", 0], ["Oman", "om", "968"], ["Pakistan", "pk", "92"], ["Palau", "pw", "680"], ["Palestine", "ps", "970"], ["Panama", "pa", "507"], ["Papua New Guinea", "pg", "675"], ["Paraguay", "py", "595"], ["Peru", "pe", "51"], ["Philippines", "ph", "63"], ["Poland", "pl", "48"], ["Portugal", "pt", "351"], ["Puerto Rico", "pr", "1", 3, ["787", "939"]], ["Qatar", "qa", "974"], ["Réunion", "re", "262", 0], ["Romania", "ro", "40"], ["Russia", "ru", "7", 0], ["Rwanda", "rw", "250"], ["Saint Barthélemy", "bl", "590", 1], ["Saint Helena", "sh", "290"], ["Saint Kitts and Nevis", "kn", "1869"], ["Saint Lucia", "lc", "1758"], ["Saint Martin", "mf", "590", 2], ["Saint Pierre and Miquelon", "pm", "508"], ["Saint Vincent and the Grenadines", "vc", "1784"], ["Samoa", "ws", "685"], ["San Marino", "sm", "378"], ["São Tomé and Príncipe", "st", "239"], ["Saudi Arabia", "sa", "966"], ["Senegal", "sn", "221"], ["Serbia", "rs", "381"], ["Seychelles", "sc", "248"], ["Sierra Leone", "sl", "232"], ["Singapore", "sg", "65"], ["Sint Maarten", "sx", "1721"], ["Slovakia", "sk", "421"], ["Slovenia", "si", "386"], ["Solomon Islands", "sb", "677"], ["Somalia", "so", "252"], ["South Africa", "za", "27"], ["South Korea", "kr", "82"], ["South Sudan", "ss", "211"], ["Spain", "es", "34"], ["Sri Lanka", "lk", "94"], ["Sudan", "sd", "249"], ["Suriname", "sr", "597"], ["Svalbard and Jan Mayen", "sj", "47", 1], ["Swaziland", "sz", "268"], ["Sweden", "se", "46"], ["Switzerland", "ch", "41"], ["Syria", "sy", "963"], ["Taiwan", "tw", "886"], ["Tajikistan", "tj", "992"], ["Tanzania", "tz", "255"], ["Thailand", "th", "66"], ["Timor-Leste", "tl", "670"], ["Togo", "tg", "228"], ["Tokelau", "tk", "690"], ["Tonga", "to", "676"], ["Trinidad and Tobago", "tt", "1868"], ["Tunisia", "tn", "216"], ["Turkey", "tr", "90"], ["Turkmenistan", "tm", "993"], ["Turks and Caicos Islands", "tc", "1649"], ["Tuvalu", "tv", "688"], ["U.S. Virgin Islands", "vi", "1340"], ["Uganda", "ug", "256"], ["Ukraine", "ua", "380"], ["United Arab Emirates", "ae", "971"], ["United Kingdom", "gb", "44", 0], ["United States", "us", "1", 0], ["Uruguay", "uy", "598"], ["Uzbekistan", "uz", "998"], ["Vanuatu", "vu", "678"], ["Vatican City", "va", "39", 1], ["Venezuela", "ve", "58"], ["Vietnam", "vn", "84"], ["Wallis and Futuna", "wf", "681"], ["Western Sahara", "eh", "212", 1], ["Yemen", "ye", "967"], ["Zambia", "zm", "260"], ["Zimbabwe", "zw", "263"], ["Åland Islands", "ax", "358", 1] ],
    	'zh-CN': [ [ "阿富汗", "af", "93" ], [ "阿尔巴尼亚", "al", "355" ], [ "阿尔及利亚", "dz", "213" ], [ "美属萨摩亚群岛", "as", "1684" ], [ "安道尔共和国", "ad", "376" ], [ "安哥拉", "ao", "244" ], [ "安圭拉岛", "ai", "1264" ], [ "安提瓜和巴布达", "ag", "1268" ], [ "阿根廷", "ar", "54" ], [ "亚美尼亚", "am", "374" ], [ "阿鲁巴", "aw", "297" ], [ "澳大利亚", "au", "61", 0 ], [ "奥地利", "at", "43" ], [ "阿塞拜疆", "az", "994" ], [ "巴哈马群岛", "bs", "1242" ], [ "巴林", "bh", "973" ], [ "孟加拉", "bd", "880" ], [ "巴巴多斯", "bb", "1246" ], [ "白俄罗斯", "by", "375" ], [ "比利时", "be", "32" ], [ "伯利兹", "bz", "501" ], [ "贝宁", "bj", "229" ], [ "百慕大群岛", "bm", "1441" ], [ "不丹", "bt", "975" ], [ "玻利维亚", "bo", "591" ], [ "波黑", "ba", "387" ], [ "博兹瓦纳", "bw", "267" ], [ "巴西", "br", "55" ], [ "英属印度洋领地", "io", "246" ], [ "英属维尔京群岛", "vg", "1284" ], [ "文莱", "bn", "673" ], [ "保加利亚", "bg", "359" ], [ "布基纳法索", "bf", "226" ], [ "布隆迪", "bi", "257" ], [ "柬埔寨", "kh", "855" ], [ "喀麦隆", "cm", "237" ], [ "加拿大", "ca", "1", 1, [ "204", "226", "236", "249", "250", "289", "306", "343", "365", "387", "403", "416", "418", "431", "437", "438", "450", "506", "514", "519", "548", "579", "581", "587", "604", "613", "639", "647", "672", "705", "709", "742", "778", "780", "782", "807", "819", "825", "867", "873", "902", "905" ] ], [ "佛得角", "cv", "238" ], [ "荷兰加勒比", "bq", "599", 1 ], [ "开曼群岛", "ky", "1345" ], [ "中非共和国", "cf", "236" ], [ "乍得", "td", "235" ], [ "智利", "cl", "56" ], [ "中国", "cn", "86" ], [ "圣诞岛", "cx", "61", 2 ], [ "科科斯(基林)群岛", "cc", "61", 1 ], [ "哥伦比亚", "co", "57" ], [ "科摩罗伊斯兰联邦", "km", "269" ], [ "刚果 (DRC)", "cd", "243" ], [ "刚果 (民主共和国)", "cg", "242" ], [ "库克群岛", "ck", "682" ], [ "哥斯达黎加", "cr", "506" ], [ "科特迪瓦", "ci", "225" ], [ "克罗地亚", "hr", "385" ], [ "古巴", "cu", "53" ], [ "库拉索岛", "cw", "599", 0 ], [ "塞浦路斯", "cy", "357" ], [ "捷克", "cz", "420" ], [ "丹麦", "dk", "45" ], [ "吉布提", "dj", "253" ], [ "多米尼克", "dm", "1767" ], [ "多米尼克共和国", "do", "1", 2, [ "809", "829", "849" ] ], [ "厄瓜多尔", "ec", "593" ], [ "埃及", "eg", "20" ], [ "萨尔瓦多", "sv", "503" ], [ "赤道几内亚", "gq", "240" ], [ "厄立特里拉", "er", "291" ], [ "爱沙尼亚", "ee", "372" ], [ "埃塞俄比亚", "et", "251" ], [ "福克兰群岛", "fk", "500" ], [ "法罗群岛", "fo", "298" ], [ "斐济", "fj", "679" ], [ "芬兰", "fi", "358", 0 ], [ "法国", "fr", "33" ], [ "法属圭亚那", "gf", "594" ], [ "法属玻利尼西亚", "pf", "689" ], [ "加蓬", "ga", "241" ], [ "刚比亚", "gm", "220" ], [ "乔治亚", "ge", "995" ], [ "德国", "de", "49" ], [ "加纳", "gh", "233" ], [ "直布罗陀", "gi", "350" ], [ "希腊", "gr", "30" ], [ "格陵兰岛", "gl", "299" ], [ "格林纳达", "gd", "1473" ], [ "瓜德罗普", "gp", "590", 0 ], [ "关岛", "gu", "1671" ], [ "危地马拉", "gt", "502" ], [ "格恩西", "gg", "44", 1 ], [ "几内亚", "gn", "224" ], [ "几内亚比绍", "gw", "245" ], [ "圭亚那", "gy", "592" ], [ "海地", "ht", "509" ], [ "洪都拉斯", "hn", "504" ], [ "香港", "hk", "852" ], [ "匈牙利", "hu", "36" ], [ "冰岛", "is", "354" ], [ "印度", "in", "91" ], [ "印尼", "id", "62" ], [ "伊朗", "ir", "98" ], [ "伊拉克", "iq", "964" ], [ "爱尔兰", "ie", "353" ], [ "马恩岛", "im", "44", 2 ], [ "以色列", "il", "972" ], [ "意大利", "it", "39", 0 ], [ "牙买加", "jm", "1876" ], [ "日本", "jp", "81" ], [ "泽西", "je", "44", 3 ], [ "约旦", "jo", "962" ], [ "哈萨克斯坦", "kz", "7", 1 ], [ "肯尼亚", "ke", "254" ], [ "基里巴斯", "ki", "686" ], [ "科威特", "kw", "965" ], [ "吉尔吉斯坦", "kg", "996" ], [ "老挝", "la", "856" ], [ "拉脱维亚", "lv", "371" ], [ "黎巴嫩", "lb", "961" ], [ "莱索托", "ls", "266" ], [ "利比里亚", "lr", "231" ], [ "利比亚", "ly", "218" ], [ "列支敦士登", "li", "423" ], [ "立陶宛", "lt", "370" ], [ "卢森堡", "lu", "352" ], [ "澳门", "mo", "853" ], [ "马其顿 (FYROM)", "mk", "389" ], [ "马达加斯加", "mg", "261" ], [ "马拉维", "mw", "265" ], [ "马来西亚", "my", "60" ], [ "马尔代夫", "mv", "960" ], [ "马里", "ml", "223" ], [ "马耳他", "mt", "356" ], [ "马绍尔群岛", "mh", "692" ], [ "马提尼克", "mq", "596" ], [ "毛利塔尼亚", "mr", "222" ], [ "毛里求斯", "mu", "230" ], [ "马约特", "yt", "262", 1 ], [ "墨西哥", "mx", "52" ], [ "密克罗尼西亚", "fm", "691" ], [ "摩尔多瓦", "md", "373" ], [ "摩纳哥", "mc", "377" ], [ "蒙古", "mn", "976" ], [ "黑山", "me", "382" ], [ "蒙特塞拉特岛", "ms", "1664" ], [ "摩洛哥", "ma", "212", 0 ], [ "莫桑比克", "mz", "258" ], [ "缅甸", "mm", "95" ], [ "纳米比亚", "na", "264" ], [ "瑙鲁", "nr", "674" ], [ "尼泊尔", "np", "977" ], [ "荷兰", "nl", "31" ], [ "新喀里多尼亚", "nc", "687" ], [ "新西兰", "nz", "64" ], [ "尼加拉瓜", "ni", "505" ], [ "尼日尔", "ne", "227" ], [ "尼日利亚", "ng", "234" ], [ "纽埃岛", "nu", "683" ], [ "诺福克岛", "nf", "672" ], [ "朝鲜", "kp", "850" ], [ "北马里亚那群岛", "mp", "1670" ], [ "挪威", "no", "47", 0 ], [ "阿曼", "om", "968" ], [ "巴基斯坦", "pk", "92" ], [ "帕劳", "pw", "680" ], [ "巴勒斯坦", "ps", "970" ], [ "巴拿马", "pa", "507" ], [ "巴布亚新几内亚", "pg", "675" ], [ "巴拉圭", "py", "595" ], [ "秘鲁", "pe", "51" ], [ "菲律宾", "ph", "63" ], [ "波兰", "pl", "48" ], [ "葡萄牙", "pt", "351" ], [ "波多黎各", "pr", "1", 3, [ "787", "939" ] ], [ "卡塔尔", "qa", "974" ], [ "留尼汪", "re", "262", 0 ], [ "罗马尼亚", "ro", "40" ], [ "俄罗斯", "ru", "7", 0 ], [ "卢旺达", "rw", "250" ], [ "圣巴泰勒米岛", "bl", "590", 1 ], [ "圣赫勒拿岛", "sh", "290" ], [ "圣克里斯托弗和尼维斯岛", "kn", "1869" ], [ "圣卢西亚岛", "lc", "1758" ], [ "圣马丁", "mf", "590", 2 ], [ "圣皮埃尔和密克隆", "pm", "508" ], [ "圣文森特和格林纳丁斯", "vc", "1784" ], [ "萨摩亚", "ws", "685" ], [ "圣马力诺", "sm", "378" ], [ "圣多美和普林西比", "st", "239" ], [ "沙特", "sa", "966" ], [ "塞内加尔", "sn", "221" ], [ "塞尔维亚", "rs", "381" ], [ "塞舌尔", "sc", "248" ], [ "塞拉利昂", "sl", "232" ], [ "新加坡", "sg", "65" ], [ "圣马丁", "sx", "1721" ], [ "斯洛伐克", "sk", "421" ], [ "斯洛文尼亚", "si", "386" ], [ "所罗门群岛", "sb", "677" ], [ "索马里", "so", "252" ], [ "南非", "za", "27" ], [ "韩国", "kr", "82" ], [ "南苏丹", "ss", "211" ], [ "西班牙", "es", "34" ], [ "斯里兰卡", "lk", "94" ], [ "苏丹", "sd", "249" ], [ "苏里南", "sr", "597" ], [ "斯瓦尔巴群岛", "sj", "47", 1 ], [ "斯威士兰", "sz", "268" ], [ "瑞典", "se", "46" ], [ "瑞士", "ch", "41" ], [ "叙利亚", "sy", "963" ], [ "台湾", "tw", "886" ], [ "塔吉克斯坦", "tj", "992" ], [ "坦桑尼亚", "tz", "255" ], [ "泰国", "th", "66" ], [ "东帝汶", "tl", "670" ], [ "多哥", "tg", "228" ], [ "托克劳群岛", "tk", "690" ], [ "汤加", "to", "676" ], [ "特立尼达和多巴哥", "tt", "1868" ], [ "突尼斯", "tn", "216" ], [ "土耳其", "tr", "90" ], [ "土库曼斯坦", "tm", "993" ], [ "特克斯和凯科斯群岛", "tc", "1649" ], [ "图瓦卢", "tv", "688" ], [ "美属维尔京群岛", "vi", "1340" ], [ "乌干达", "ug", "256" ], [ "乌克兰", "ua", "380" ], [ "阿联酋", "ae", "971" ], [ "英国", "gb", "44", 0 ], [ "美国", "us", "1", 0 ], [ "乌拉圭", "uy", "598" ], [ "乌兹别克斯坦", "uz", "998" ], [ "瓦努阿图", "vu", "678" ], [ "梵蒂冈", "va", "39", 1 ], [ "委内瑞拉", "ve", "58" ], [ "越南", "vn", "84" ], [ "瓦利斯和富图纳群岛", "wf", "681" ], [ "西撒哈拉", "eh", "212", 1 ], [ "也门", "ye", "967" ], [ "赞比亚", "zm", "260" ], [ "津巴布韦", "zw", "263" ], [ "奥兰群岛", "ax", "358", 1 ] ],
    	'ja-JP': [ [ "アフガニスタン", "af", "93" ], [ "アルバニア", "al", "355" ], [ "アルジェリア", "dz", "213" ], [ "米領サモア", "as", "1684" ], [ "アンドラ", "ad", "376" ], [ "アンゴラ", "ao", "244" ], [ "アンギラ", "ai", "1264" ], [ "アンティグア・バーブーダ", "ag", "1268" ], [ "アルゼンチン", "ar", "54" ], [ "アルメニア", "am", "374" ], [ "アルバ", "aw", "297" ], [ "オーストラリア", "au", "61", 0 ], [ "オーストリア", "at", "43" ], [ "アゼルバイジャン", "az", "994" ], [ "バハマ", "bs", "1242" ], [ "バーレーン", "bh", "973" ], [ "バングラデシュ", "bd", "880" ], [ "バルバドス", "bb", "1246" ], [ "ベラルーシ", "by", "375" ], [ "ベルギー", "be", "32" ], [ "ベリーズ", "bz", "501" ], [ "ベナン", "bj", "229" ], [ "バミューダ諸島", "bm", "1441" ], [ "ブータン", "bt", "975" ], [ "ボリビア", "bo", "591" ], [ "ボスニア・ヘルツェゴビナ", "ba", "387" ], [ "ボツワナ", "bw", "267" ], [ "ブラジル", "br", "55" ], [ "英領インド洋地域", "io", "246" ], [ "英領ヴァージン諸島", "vg", "1284" ], [ "ブルネイ", "bn", "673" ], [ "ブルガリア", "bg", "359" ], [ "ブルキナ ファソ", "bf", "226" ], [ "ブルンジ", "bi", "257" ], [ "カンボジア", "kh", "855" ], [ "カメルーン", "cm", "237" ], [ "カナダ", "ca", "1", 1, [ "204", "226", "236", "249", "250", "289", "306", "343", "365", "387", "403", "416", "418", "431", "437", "438", "450", "506", "514", "519", "548", "579", "581", "587", "604", "613", "639", "647", "672", "705", "709", "742", "778", "780", "782", "807", "819", "825", "867", "873", "902", "905" ] ], [ "カーボベルデ", "cv", "238" ], [ "カリブ海オランダ領", "bq", "599", 1 ], [ "ケイマン諸島", "ky", "1345" ], [ "中央アフリカ共和国", "cf", "236" ], [ "チャド", "td", "235" ], [ "チリ", "cl", "56" ], [ "中国", "cn", "86" ], [ "クリスマス島", "cx", "61", 2 ], [ "ココス (キーリング) 諸島", "cc", "61", 1 ], [ "コロンビア", "co", "57" ], [ "コモロ", "km", "269" ], [ "コンゴ民主共和国", "cd", "243" ], [ "コンゴ共和国", "cg", "242" ], [ "クック諸島", "ck", "682" ], [ "コスタリカ", "cr", "506" ], [ "コートジボワール", "ci", "225" ], [ "クロアチア", "hr", "385" ], [ "キューバ", "cu", "53" ], [ "キュラソー島", "cw", "599", 0 ], [ "キプロス", "cy", "357" ], [ "チェコ共和国", "cz", "420" ], [ "デンマーク", "dk", "45" ], [ "ジブチ", "dj", "253" ], [ "ドミニカ国", "dm", "1767" ], [ "ドミニカ共和国", "do", "1", 2, [ "809", "829", "849" ] ], [ "エクアドル", "ec", "593" ], [ "エジプト", "eg", "20" ], [ "エルサルバドル", "sv", "503" ], [ "赤道ギニア", "gq", "240" ], [ "エリトリア", "er", "291" ], [ "エストニア", "ee", "372" ], [ "エチオピア", "et", "251" ], [ "フォークランド諸島", "fk", "500" ], [ "フェロー諸島", "fo", "298" ], [ "フィジー", "fj", "679" ], [ "フィンランド", "fi", "358", 0 ], [ "フランス", "fr", "33" ], [ "仏領ギアナ", "gf", "594" ], [ "仏領ポリネシア", "pf", "689" ], [ "ガボン", "ga", "241" ], [ "ガンビア", "gm", "220" ], [ "ジョージア (旧グルジア)", "ge", "995" ], [ "ドイツ", "de", "49" ], [ "ガーナ", "gh", "233" ], [ "ジブラルタル", "gi", "350" ], [ "ギリシャ", "gr", "30" ], [ "グリーンランド", "gl", "299" ], [ "グレナダ", "gd", "1473" ], [ "グアドループ島", "gp", "590", 0 ], [ "グアム", "gu", "1671" ], [ "グアテマラ", "gt", "502" ], [ "ガーンジー島", "gg", "44", 1 ], [ "ギニア", "gn", "224" ], [ "ギニアビサウ", "gw", "245" ], [ "ガイアナ", "gy", "592" ], [ "ハイチ", "ht", "509" ], [ "ホンジュラス", "hn", "504" ], [ "香港", "hk", "852" ], [ "ハンガリー", "hu", "36" ], [ "アイスランド", "is", "354" ], [ "インド", "in", "91" ], [ "インドネシア", "id", "62" ], [ "イラン", "ir", "98" ], [ "イラク", "iq", "964" ], [ "アイルランド", "ie", "353" ], [ "マン島", "im", "44", 2 ], [ "イスラエル", "il", "972" ], [ "イタリア", "it", "39", 0 ], [ "ジャマイカ", "jm", "1876" ], [ "日本", "jp", "81" ], [ "ジャージー", "je", "44", 3 ], [ "ヨルダン", "jo", "962" ], [ "カザフスタン", "kz", "7", 1 ], [ "ケニア", "ke", "254" ], [ "キリバス", "ki", "686" ], [ "クウェート", "kw", "965" ], [ "キルギス", "kg", "996" ], [ "ラオス", "la", "856" ], [ "ラトビア", "lv", "371" ], [ "レバノン", "lb", "961" ], [ "レソト", "ls", "266" ], [ "リベリア", "lr", "231" ], [ "リビア", "ly", "218" ], [ "リヒテンシュタイン", "li", "423" ], [ "リトアニア", "lt", "370" ], [ "ルクセンブルク", "lu", "352" ], [ "マカオ", "mo", "853" ], [ "マケドニア (FYROM)", "mk", "389" ], [ "マダガスカル", "mg", "261" ], [ "マラウイ", "mw", "265" ], [ "マレーシア", "my", "60" ], [ "モルディブ", "mv", "960" ], [ "マリ", "ml", "223" ], [ "マルタ", "mt", "356" ], [ "マーシャル諸島", "mh", "692" ], [ "マルティニーク", "mq", "596" ], [ "モーリタニア", "mr", "222" ], [ "モーリシャス", "mu", "230" ], [ "マヨット", "yt", "262", 1 ], [ "メキシコ", "mx", "52" ], [ "ミクロネシア", "fm", "691" ], [ "モルドバ", "md", "373" ], [ "モナコ", "mc", "377" ], [ "モンゴル", "mn", "976" ], [ "モンテネグロ", "me", "382" ], [ "モントセラト", "ms", "1664" ], [ "モロッコ", "ma", "212", 0 ], [ "モザンビーク", "mz", "258" ], [ "ミャンマー", "mm", "95" ], [ "ナミビア", "na", "264" ], [ "ナウル", "nr", "674" ], [ "ネパール", "np", "977" ], [ "オランダ", "nl", "31" ], [ "ニューカレドニア", "nc", "687" ], [ "ニュージーランド", "nz", "64" ], [ "ニカラグア", "ni", "505" ], [ "ニジェール", "ne", "227" ], [ "ナイジェリア", "ng", "234" ], [ "ニウエ", "nu", "683" ], [ "ノーフォーク島", "nf", "672" ], [ "北朝鮮", "kp", "850" ], [ "北マリアナ諸島", "mp", "1670" ], [ "ノルウェー", "no", "47", 0 ], [ "オマーン", "om", "968" ], [ "パキスタン", "pk", "92" ], [ "パラオ", "pw", "680" ], [ "パレスチナ", "ps", "970" ], [ "パナマ", "pa", "507" ], [ "パプアニューギニア", "pg", "675" ], [ "パラグアイ", "py", "595" ], [ "ペルー", "pe", "51" ], [ "フィリピン", "ph", "63" ], [ "ポーランド", "pl", "48" ], [ "ポルトガル", "pt", "351" ], [ "プエルトリコ", "pr", "1", 3, [ "787", "939" ] ], [ "カタール", "qa", "974" ], [ "レユニオン", "re", "262", 0 ], [ "ルーマニア", "ro", "40" ], [ "ロシア", "ru", "7", 0 ], [ "ルワンダ", "rw", "250" ], [ "サン・バルテルミー島", "bl", "590", 1 ], [ "セントヘレナ", "sh", "290" ], [ "セントクリストファー ネイビス", "kn", "1869" ], [ "セントルシア", "lc", "1758" ], [ "セント マーチン島", "mf", "590", 2 ], [ "サンピエール島 ミクロン島", "pm", "508" ], [ "セントビンセントおよびグレナディーン諸島", "vc", "1784" ], [ "サモア", "ws", "685" ], [ "サンマリノ", "sm", "378" ], [ "サントメ プリンシペ", "st", "239" ], [ "サウジアラビア", "sa", "966" ], [ "セネガル", "sn", "221" ], [ "セルビア", "rs", "381" ], [ "セーシェル", "sc", "248" ], [ "シエラレオネ", "sl", "232" ], [ "シンガポール", "sg", "65" ], [ "シント・マールテン島", "sx", "1721" ], [ "スロバキア", "sk", "421" ], [ "スロベニア", "si", "386" ], [ "ソロモン諸島", "sb", "677" ], [ "ソマリア", "so", "252" ], [ "南アフリカ", "za", "27" ], [ "韓国", "kr", "82" ], [ "南スーダン", "ss", "211" ], [ "スペイン", "es", "34" ], [ "スリランカ", "lk", "94" ], [ "スーダン", "sd", "249" ], [ "スリナム", "sr", "597" ], [ "スバールバル諸島ヤン マイエン島", "sj", "47", 1 ], [ "スワジランド", "sz", "268" ], [ "スウェーデン", "se", "46" ], [ "スイス", "ch", "41" ], [ "シリア", "sy", "963" ], [ "台湾", "tw", "886" ], [ "タジキスタン", "tj", "992" ], [ "タンザニア", "tz", "255" ], [ "タイ", "th", "66" ], [ "東ティモール", "tl", "670" ], [ "トーゴ", "tg", "228" ], [ "トケラウ諸島", "tk", "690" ], [ "トンガ", "to", "676" ], [ "トリニダード・トバゴ", "tt", "1868" ], [ "チュニジア", "tn", "216" ], [ "トルコ", "tr", "90" ], [ "トルクメニスタン", "tm", "993" ], [ "タークス カイコス諸島", "tc", "1649" ], [ "ツバル", "tv", "688" ], [ "米領ヴァージン諸島", "vi", "1340" ], [ "ウガンダ", "ug", "256" ], [ "ウクライナ", "ua", "380" ], [ "アラブ首長国連邦", "ae", "971" ], [ "英国", "gb", "44", 0 ], [ "米国", "us", "1", 0 ], [ "ウルグアイ", "uy", "598" ], [ "ウズベキスタン", "uz", "998" ], [ "バヌアツ", "vu", "678" ], [ "バチカン市国", "va", "39", 1 ], [ "ベネズエラ", "ve", "58" ], [ "ベトナム", "vn", "84" ], [ "ウォリス フツナ", "wf", "681" ], [ "西サハラ", "eh", "212", 1 ], [ "イエメン", "ye", "967" ], [ "ザンビア", "zm", "260" ], [ "ジンバブエ", "zw", "263" ], [ "オーランド諸島", "ax", "358", 1 ] ]
    };

    var allCountries = [];
    $.fn[pluginName].setLocale('en-US');
});
