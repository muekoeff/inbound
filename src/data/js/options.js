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

init();
document.addEventListener("DOMContentLoaded", restoreOptions);

// ---

var folderPicker = {
	addNodes: function(nodes) {
		var html = `<ul>`;
		nodes.forEach(function(node) {
			if(node.type === "folder") {
				html += `<li>`;
				html += `<a href="#${node.id}" data-id="${node.id}">${(node.title.length > 0 ? node.title : `<i>${_e("options_unnamed")}</i>`)}</a>`;
				if("children" in node && node.children.length > 0) {
					html += folderPicker.addNodes(node.children);
				}
				html += `</li>`;
			}
		});
		html += `</ul>`;
		return html;
	},
	init: function(container) {
		var bookmarks = browser.bookmarks.getTree().then(function(e) {
			document.getElementById("folderPicker").innerHTML = folderPicker.addNodes(e);

			document.querySelectorAll("#folderPicker a").forEach(function(item) {
				item.addEventListener("click", function(e) {
					window.location.hash = "#output_bookmarkRoot";
					document.getElementById("output_bookmarkRoot").innerHTML = this.innerHTML;
					document.getElementById("output_bookmarkRoot").setAttribute("data-id", this.getAttribute("data-id"));
					document.getElementById("output_bookmarkFolderName").removeAttribute("disabled");
					document.getElementById("output_bookmarkCreate").removeAttribute("disabled");
				});
			});
		});
		document.getElementById("output_bookmarkCreate").addEventListener("click", function(e) {
			document.getElementById("output_bookmarkFolderName").setAttribute("disabled", "disabled");
			document.getElementById("output_bookmarkCreate").setAttribute("disabled", "disabled");

			var bookmark = browser.bookmarks.create({
				parentId: document.getElementById("output_bookmarkRoot").getAttribute("data-id"),
				title: document.getElementById("output_bookmarkFolderName").value,
				type: "folder"
			}).then(function(e) {
				browser.storage.local.set({"output_bookmarkRootId": e.id}).then(function() {
					document.getElementById("output_folderId").innerHTML = `${document.getElementById("output_bookmarkFolderName").value} (${e.id})`;
					document.getElementById("panel_output").classList.remove("highlight");
					browser.runtime.sendMessage({
						command: MESSAGE_COMMANDS.setBookmarkRootId,
						content: e.id
					});
					browser.runtime.sendMessage({
						command: MESSAGE_COMMANDS.basicNotification,
						content: _e("options_bookmarkCreationSuccessful", e.title)
					});
				});
			});
		});
	},
};

function bindSaveEvent() {
	var options = document.querySelectorAll(".option");
	for(var i = 0; i < options.length; i++) {
		options[i].addEventListener("change", saveOptions)
	}
}
function init() {
	document.getElementById("option--account_requestGrant").addEventListener("click", function() {
		browser.runtime.sendMessage({
			command: MESSAGE_COMMANDS.auth
		});
	});
	bindSaveEvent();
	document.getElementById("output_loadBookmarkTree").addEventListener("click", function(e) {
		this.setAttribute("disabled", "disabled");
		this.innerHTML = _e("options_loading_e");
		folderPicker.init();
	});
	browser.runtime.sendMessage({
		command: MESSAGE_COMMANDS.getVerifySimple
	}).then(function(e) {
		if(!e.content) {
			document.getElementById("panel_account").className += " highlight";
		} else {
			browser.runtime.sendMessage({
				command: MESSAGE_COMMANDS.getUsername
			});
		}
	});
}
function restoreOptions() {
	function setCurrentChoice(result) {
		for(const item in result) {
			let optionItem = document.querySelector("#option--" + item);
			if(optionItem != null) {
				switch(document.querySelector("#option--" + item).tagName) {
					case "INPUT":
						switch(optionItem.getAttribute("type")) {
							case "checkbox":
								optionItem.checked = result[item];
								break;
							case "text":
								optionItem.value = result[item];
								break;
						}
				}
			}
		}

		if("output_bookmarkRootId" in result && "output_bookmarkRootId" != "") {
			document.getElementById("output_folderId").innerHTML = result["output_bookmarkRootId"];
			browser.bookmarks.get(result["output_bookmarkRootId"]).then(function(e) {
				document.getElementById("output_folderId").innerHTML = `${e[0].title} (${document.getElementById("output_folderId").innerHTML})`;
			}, function(e) {
				document.getElementById("output_folderId").innerHTML = `<i>${_e("options_bookmarkFindFailed")}</i> (${document.getElementById("output_folderId").innerHTML})`;
				document.getElementById("panel_output").className = " highlight";
			});
		} else {
			document.getElementById("panel_output").className = " highlight";
		}
	}

	function onError(error) {
		browser.runtime.sendMessage({
			command: MESSAGE_COMMANDS.basicNotification,
			content: _e("options_restoreOptionsFailed", error)
		});
	}

	var getting = browser.storage.local.get();
	getting.then(setCurrentChoice, onError);
}
function saveOptions(e) {
	e.preventDefault();
	var options = document.querySelectorAll(".option");
	var settings = {};

	options.forEach(function(element) {
		switch(element.tagName) {
			case "INPUT":
				switch(element.getAttribute("type")) {
					case "checkbox":
						settings[element.id.replace("option--", "")] = element.checked;
						break;
					case "text":
						settings[element.id.replace("option--", "")] = element.value;
						break;
				}
		}
	});
	console.log(settings);

	browser.storage.local.set(settings).then(function(e) {
		browser.runtime.sendMessage({
			command: MESSAGE_COMMANDS.reloadSettings
		});
	});
}
function _e(id, param) {
	if(typeof param != "undefined" && param != null) {
		return browser.i18n.getMessage(id, param);
	} else {
		return browser.i18n.getMessage(id);
	}
}

// ---

browser.runtime.onMessage.addListener(function(message, sender, sendResponse) {
	switch(message.command) {
		case MESSAGE_COMMANDS.authFinished:
			console.log("MESSAGE_COMMANDS.authFinished");
			document.getElementById("account_redditUsername").innerHTML = message.content;
			document.getElementById("panel_account").classList.remove("highlight");
			break;
		case MESSAGE_COMMANDS.noAuth:
			console.log("MESSAGE_COMMANDS.noAuth");
			document.getElementById("panel_account").classList.add("highlight");
			break;
	};
});