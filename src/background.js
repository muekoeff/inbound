var inbound = {
	authorisation: {
		CLIENT_ID: "cV7fIUajw4xQAQ",
		accessToken: null,
		expiresAt: null,
		refreshToken: null,
		state: null,
		username: null
	},
	data: {
		_loaded: false,
		bookmarkRootId: null,
		initialSync: false,
		isSyncing: false
	},
	messages: {
		displayedLoginReminder: false
	}
};
var redditApi = {
	auth: {
		flow: function() {
			let url = new URL("https://www.reddit.com/api/v1/authorize");
			url.searchParams.set("client_id", inbound.authorisation.CLIENT_ID);
			url.searchParams.set("response_type", "code");
			inbound.authorisation.state = util.random(10);
			url.searchParams.set("state", inbound.authorisation.state);
			url.searchParams.set("redirect_uri", browser.identity.getRedirectURL());
			url.searchParams.set("duration", "permanent");
			url.searchParams.set("scope", ['history', 'identity'].join(","));

			return browser.identity.launchWebAuthFlow({
				url: url.href,
				interactive: true,
			});
		},
		getToken: function(code, onSuccess, onError) {
			redditApi.postBasic("/api/v1/access_token", util.encodeUriItems({
				"code": code,
				"grant_type": "authorization_code",
				"redirect_uri": inbound.authorisation.REDIRECT_URI
			}), function(e) {
				if(!("error" in e)) {
					inbound.authorisation.accessToken = e.access_token;
					inbound.authorisation.expiresAt = Date.now() + e.expires_in - 60;	// 60 seconds tolerance
					inbound.authorisation.refreshToken = e.refresh_token;

					browser.storage.local.set({
						auth_accessToken: inbound.authorisation.accessToken,
						auth_expiresAt: inbound.authorisation.expiresAt,
						auth_refreshToken: inbound.authorisation.refreshToken
					});
					util.basicNotification(_e("background_authenticationSuccessful"));

					if(is(onSuccess)) onSuccess();
				} else {
					util.basicNotification(`${_e("background_authenticationFailed")} ${e.error}`);
					if(is(onError)) onError();
				}
			}, function(xhr) {
				util.basicNotification(`${_e("background_requestFailed")} ${xhr.status} ${xhr.statusText}`);
				if(is(onError)) onError();
			})
		},
		purge: function() {
			inbound.authorisation.accessToken = null;
			inbound.authorisation.expiresAt = null;
			inbound.authorisation.refreshToken = null;

			browser.storage.local.set({
				auth_accessToken: inbound.authorisation.accessToken,
				auth_expiresAt: inbound.authorisation.expiresAt,
				auth_refreshToken: inbound.authorisation.refreshToken
			});

			util.basicNotification(_e("background_requestFailed"));
			browser.runtime.sendMessage({
				command: MESSAGE_COMMANDS.noAuth
			});
		},
		refreshToken: function(onSuccess, onError) {
			redditApi.postBasic("/api/v1/access_token", util.encodeUriItems({
				"duration": "permanent",
				"grant_type": "refresh_token",
				"refresh_token": inbound.authorisation.refreshToken
			}), function(e) {
				if(!("error" in e)) {
					inbound.authorisation.accessToken = e.access_token;
					inbound.authorisation.expiresAt = Date.now() + (e.expires_in * 100) - 60000;	// Convert Reddit's seconds to miliseconds and substract 60 seconds tolerance
					// DON'T EVEN ASK HOW LONG IT TOOK TO REALIZE THAT I *DON'T* NEED A NEW REFRESH TOKEN

					browser.storage.local.set({
						auth_accessToken: inbound.authorisation.accessToken,
						auth_expiresAt: inbound.authorisation.expiresAt,
						auth_refreshToken: inbound.authorisation.refreshToken
					});

					if(is(onSuccess)) onSuccess();
				} else {
					console.error(e);
					util.basicNotification(`${_e("background_reauthenticationFailed")} ${e.error}`);
					if(is(onError)) onError();
				}
			}, function(xhr) {
				if(xhr.status == 400) {
					redditApi.auth.purge();
				} else {
					util.basicNotification(`${_e("background_reauthenticationFailed")} ${xhr.status} ${xhr.statusText}`);
				}
				if(is(onError)) onError(xhr);
			})
		},
		start: function() {
			redditApi.auth.flow().then(function(e) {
				let url = new URL(e);
				if(url.searchParams.get("state") === inbound.authorisation.state) {
					if(url.searchParams.get("error") === null) {
						let code = url.searchParams.get("code");
						if(typeof code != null) {
							redditApi.auth.getToken(code, function() {
								redditApi.getUsername();
							});
						}
					} else {
						switch(url.searchParams.get("error")) {
							case "access_denied":
								util.basicNotification(_e("background_authenticationDenied"));
								break;
							default:
								util.basicNotification(_e("background_authenticationFailedReddit", url.searchParams.get("error")));
						}
					}					
				} else {
					util.basicNotification(_e("background_authenticationFailedState", [url.searchParams.get("state"), inbound.authorisation.state]));
				}
			}, function(e) {
				util.basicNotification(`${_e("background_authenticationFailed")} ${e}`);
			});
		},
		verify: function(onSuccess, onError) {
			if(redditApi.auth.verifySimple() && Date.now() < inbound.authorisation.expiresAt) {
				if(is(onSuccess)) onSuccess();
				return true;
			} else if(Date.now() > inbound.authorisation.expiresAt) {
				redditApi.auth.refreshToken((is(onSuccess) ? onSuccess : null),
					(is(onError) ? onError : null));
			} else {
				if(!inbound.messages.displayedLoginReminder) {
					inbound.messages.displayedLoginReminder = true;
					util.basicNotification(_e("background_notAuthorised"));
				}
			}
		},
		verifySimple: function() {
			return is(inbound.authorisation.accessToken) && is(inbound.authorisation.refreshToken);
		}
	},
	get: function(endpoint, onSuccess, onError, onAuthError) {
		if(inbound.data._loaded) {
			redditApi.auth.verify(function() {
				let xhr = new XMLHttpRequest();
				xhr.withCredentials = true;
				xhr.open("GET", `https://oauth.reddit.com${endpoint}`, true);
				xhr.setRequestHeader("Authorization", `bearer ${inbound.authorisation.accessToken}`);
				xhr.onreadystatechange = function(e) {
					if(xhr.readyState === 4) {
						if(xhr.status === 200) {
							var response = JSON.parse(xhr.responseText);
							if(is(onSuccess)) onSuccess(response);
						} else if(xhr.status === 401) {
							redditApi.auth.purge();
							if(is(onError)) onError(xhr);
						} else {
							console.error(xhr);
							if(is(onError)) onError(xhr);
						}
					}
				};
				xhr.onerror = function(e) {
					console.error(xhr);
				};
				xhr.send();
			}, (is(onError) ? onError : null), function() {
				console.error("CANCELLED");
				return;
			});
		}
	},
	postBasic: function(endpoint, content, onSuccess, onError) {
		let xhr = new XMLHttpRequest();
		xhr.withCredentials = true;
		xhr.open("POST", `https://www.reddit.com${endpoint}`, true);
		xhr.setRequestHeader("Authorization", `Basic ${btoa(`${inbound.authorisation.CLIENT_ID}:`)}`);
		xhr.setRequestHeader("Content-type", "application/x-www-form-urlencoded");
		xhr.onreadystatechange = function(e) {
			if(xhr.readyState === 4) {
				if(xhr.status === 200) {
					var response = JSON.parse(xhr.responseText);
					onSuccess(response);
				} else {
					console.error(xhr);
					if(is(onError)) onError(xhr);
				}
			}
		};
		xhr.onerror = function(e) {
			console.error(xhr);
			if(is(onError)) onError(xhr);
		};
		xhr.send(content);
	},
	getSaved: function(onSuccess, onError) {
		if(!is(inbound.authorisation.username)) {
			redditApi.getUsername(function() {
				redditApi._getSaved(onSuccess, onError);
			});
		} else {
			redditApi._getSaved(onSuccess, onError);
		}
	},
	_getSaved: function(onSuccess, onError) {
		redditApi.get(`/user/${inbound.authorisation.username}/saved`, function(e) {
			onSuccess(e);
		}, function(xhr) {
			if(is(onError)) onError(xhr);
		});
	},
	getUsername: function(onSuccess, onError) {
		redditApi.get("/api/v1/me", function(e) {
			inbound.authorisation.username = e.name;
			browser.runtime.sendMessage({
				command: MESSAGE_COMMANDS.authFinished,
				content: e.name
			});
			if(is(onSuccess)) onSuccess(e);
		}, function(xhr) {
			if(is(onError)) onError(xhr);
		});
	}
};
var util = {
	basicNotification: function(message) {
		browser.notifications.create("", {
			type: "basic",
			message: message,
			title: _e("extension_name_short")
		});
	},
	encodeUriItems: function(headerObject) {
		let headerItems = [];
		Object.keys(headerObject).map(function(objectKey, index) {
			headerItems.push(`${encodeURIComponent(objectKey)}=${encodeURIComponent(headerObject[objectKey])}`);
		});
		return headerItems.join("&");
	},
	random: function(length) {
		var text = "";
		var possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
		for(var i = 0; i < length; i++) {
			text += possible.charAt(Math.floor(Math.random() * possible.length));
		}
		return text;
	}
}
const MESSAGE_COMMANDS = {
	auth: "auth",
	authFinished: "authFinished",
	basicNotification: "basicNotification",
	getUsername: "getUsername",
	getVerifySimple: "getVerifySimple",
	noAuth: "noAuth",
	reloadSettings: "reloadSettings",
	setBookmarkRootId: "setBookmarkRootId"
};

// ---

browser.browserAction.onClicked.addListener(function(e) {
	if(redditApi.auth.verifySimple() && is(inbound.data.bookmarkRootId)) {
		performSync(inbound.data.bookmarkRootId);
	} else {
		browser.runtime.openOptionsPage().then(function() {
			util.basicNotification(_e("background_promptConfigurationSteps"));
		}, function() {
			util.basicNotification(_e("background_promptConfiguration"));
		});
	}
});
browser.runtime.onMessage.addListener(function(message, sender, sendResponse) {
	switch(message.command) {
		case MESSAGE_COMMANDS.auth:
			redditApi.auth.start();
			break;
		case MESSAGE_COMMANDS.basicNotification:
			util.basicNotification(message.content);
			break;
		case MESSAGE_COMMANDS.getUsername:
			redditApi.getUsername();
			break;
		case MESSAGE_COMMANDS.getVerifySimple:
			sendResponse({
				content: redditApi.auth.verifySimple()
			});
			break;
		case MESSAGE_COMMANDS.reloadSettings:
			loadSettings();
			break;
		case MESSAGE_COMMANDS.setBookmarkRootId:
			inbound.data.bookmarkRootId = message.content;
	};
});
loadSettings();


// ---

function is(target) {
	return typeof target != "undefined" && target !== null;
}
function loadSettings() {
	browser.storage.local.get().then(dataLoaded);

	function dataLoaded(result) {
		inbound.getting = result;
		inbound.authorisation.accessToken = inbound.getting.auth_accessToken;
		inbound.authorisation.expiresAt = new Date(parseInt(inbound.getting.auth_expiresAt));
		inbound.authorisation.refreshToken = inbound.getting.auth_refreshToken;
		inbound.data.bookmarkRootId = inbound.getting.output_bookmarkRootId;

		inbound.data._loaded = true;

		defaultSettings();
		if(setting("general_syncOnBrowserStart", inbound.getting) && !inbound.data.initialSync) performSync(inbound.data.bookmarkRootId);
		inbound.data.initialSync = true;
	}
	function defaultSettings() {
		checkSetting("general_notifyOnFail", true);
		checkSetting("general_notifyOnSuccess", true);
		checkSetting("bookmark_comments", "%body%");
		checkSetting("bookmark_links", "%title%");
	}
	function checkSetting(name, value) {
		if(!is(inbound.getting[name])) {
			var pair = {};
			pair[name] = value;
			browser.storage.local.set(pair)
			inbound.getting[name] = value;
		}
	}
}
function performSync(bookmarkRootId) {
	var total;

	if(inbound.data.isSyncing) {
		return;
	}
	if(is(bookmarkRootId)) {
		inbound.data.isSyncing = true;
		fetchSaves(function(e) {
			clearFolder(function() {
				total = e.data.children.length;
				e.data.children.forEach(function(item) {
					switch(item.kind) {
						case "t1":
							createBookmark(getParsed(item, inbound.getting.bookmark_comments), "https://reddit.com" + item.data.permalink);
							break;
						case "t3":
							createBookmark(getParsed(item, inbound.getting.bookmark_links), "https://reddit.com" + item.data.permalink);
							break;
					}
				});
				inbound.data.isSyncing = false;
			}, function(e) {
				console.error(e);
				util.basicNotification(_e("background_cantAccessFolder"));
				inbound.data.isSyncing = false;
			});
		}, function(e) {
			util.basicNotification(_e("background_requestFailed"));
			inbound.data.isSyncing = false;
		});
	} else {
		util.basicNotification(_e("background_specifyRoot"));
	}

	function checkFinished() {
		if(total == 0) {
			if(setting("general_notifyOnSuccess", inbound.getting)) {
				util.basicNotification(_e("background_syncSuccessful"));
			}
		}
	}
	function createBookmark(title, url) {
		browser.bookmarks.create({
			parentId: bookmarkRootId,
			title: title,
			type: "bookmark",
			url: url
		}).then(function(e) {
			total--;
			checkFinished();
		});
	}
	function clearFolder(onSuccess, onError) {
		browser.bookmarks.getSubTree(bookmarkRootId).then(function(e) {
			e[0].children.forEach(function(item) {
				browser.bookmarks.remove(item.id);
			});

			if(is(onSuccess)) onSuccess();
		}, function(e) {
			if(is(onError)) onError(e);
		});
	}
	function fetchSaves(onSuccess, onError) {
		redditApi.getSaved(function(e) {
			if(is(onSuccess)) onSuccess(e);
		}, function(e) {
			if(is(onError)) onError(e);
		});
	}
	function getParsed(redditItem, pattern) {
		var out = pattern;
		pattern.match(/(\%[^ \%]+\%)+/gi).forEach(function(item) {
			var index = item.substring(1, item.length - 1);
			out = out.replace(item, (typeof redditItem.data[index] != "undefined" ? redditItem.data[index] : `{NotFound:${index}}`) );
		});
		return out;
	}
}
function setting(name, parent) {
	return name in parent && parent[name];
}
function _e(id, param) {
	if(typeof param != "undefined" && param != null) {
		return browser.i18n.getMessage(id, param);
	} else {
		return browser.i18n.getMessage(id);
	}
}
