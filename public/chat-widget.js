/* ============================================================
   Webex Connect JS SDK — chat widget controller
   Docs: https://developers.webexconnect.io/docs/javascript-sdk-quickstart-guide
   Asset: AX21152542 (from assets/js/imi-environments.js)

   This file wires the SDK's documented calls (startup, register,
   setICMessagingReceiver, connect, createThread, publishMessage)
   to the custom UI in index.html. It renders whatever the real
   asset/flow sends back — including quick-reply buttons — using
   the message accessors confirmed against the SDK bundle:
   message.getInteractiveData().getQuickReplyData().getButtons(),
   each button exposing getTitle() / getValue().

   If nothing arrives from the live flow within DEMO_FALLBACK_MS,
   a clearly-labelled static preview (matching the target screenshot)
   is shown instead, purely so the UI can be reviewed before the
   flow/branding side is fully configured in Webex Engage.
   ============================================================ */

(function () {
  var DEMO_FALLBACK_MS = 4000;

  var els = {};
  var icThread = null;
  var demoTimer = null;
  var usingDemoData = false;
  var chatStarted = false; // set synchronously on first call — prevents
                            // setICMessagingReceiver() from ever being
                            // registered more than once, even if openPanel()
                            // fires again during the async gap before
                            // createThread() resolves and icThread gets set.
  var closeNoticeShown = false; // guards against duplicate close notices —
                                 // an agent-initiated close was observed to
                                 // arrive as BOTH a $$$$$AGENTCLOSECHAT$$$$
                                 // sentinel message AND a separate
                                 // ICMessageType.CloseThread message for the
                                 // same real event (confirmed against
                                 // Cisco's own widget source, which has its
                                 // own dedup logic for exactly this).

  function q(id) { return document.getElementById(id); }

  function cacheEls() {
    els.launcher = q("cw-launcher");
    els.panel = q("cw-panel");
    els.minimize = q("cw-minimize");
    els.close = q("cw-close");
    els.endChat = q("cw-end-chat");
    els.body = q("cw-body");
    els.thread = q("cw-thread");
    els.status = q("cw-status");
    els.input = q("cw-input");
    els.send = q("cw-send");
    els.langToggle = q("cw-lang-toggle");
    els.langMenu = q("cw-lang-menu");
    els.emojiToggle = q("cw-emoji-toggle");
    els.emojiPanel = q("cw-emoji-panel");
    els.attachToggle = q("cw-attach-toggle");
    els.fileInput = q("cw-file-input");
  }

  function openPanel() {
    els.panel.hidden = false;
    els.launcher.hidden = true;
    if (!chatStarted) {
      chatStarted = true;
      startChat(); // startChat() itself now handles/reports a missing IMI SDK
    } else if (!icThread) {
      // Receiver is already registered from the first call — just need a
      // fresh thread (e.g. after ending a conversation), not a full restart.
      createThread();
    }
  }
  function closePanel() {
    els.panel.hidden = true;
    els.launcher.hidden = false;
  }

  function nowLabel() {
    return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }).toLowerCase();
  }

  function clearStatus() {
    if (els.status) {
      els.status.remove();
      els.status = null;
    }
  }

  function renderFormattedText(container, text) {
    var lines = String(text).split(/\r?\n/);
    var i = 0;
    while (i < lines.length) {
      var line = lines[i];
      var isBullet = /^\s*[-*]\s+/.test(line);
      if (isBullet) {
        var ul = document.createElement("ul");
        ul.className = "cw-bubble-list";
        while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
          var li = document.createElement("li");
          li.textContent = lines[i].replace(/^\s*[-*]\s+/, "");
          ul.appendChild(li);
          i++;
        }
        container.appendChild(ul);
      } else if (line.trim() === "") {
        i++; // skip blank lines between paragraphs, spacing handled via CSS
      } else {
        var p = document.createElement("p");
        p.className = "cw-bubble-line";
        p.textContent = line;
        container.appendChild(p);
        i++;
      }
    }
  }

  function appendAgentBubble(text) {
    clearStatus();
    var row = document.createElement("div");
    row.className = "cw-row agent";
    row.innerHTML = '<div class="cw-bubble"></div><div class="cw-time"></div>';
    renderFormattedText(row.querySelector(".cw-bubble"), text);
    row.querySelector(".cw-time").textContent = nowLabel();
    els.thread.appendChild(row);
    els.body.scrollTop = els.body.scrollHeight;
    return row;
  }

  function appendUserBubble(text) {
    clearStatus();
    var row = document.createElement("div");
    row.className = "cw-row user";
    row.innerHTML =
      '<div class="cw-bubble"></div><div class="cw-time"></div>';
    row.querySelector(".cw-bubble").textContent = text;
    row.querySelector(".cw-time").textContent = nowLabel();
    els.thread.appendChild(row);
    els.body.scrollTop = els.body.scrollHeight;
  }

  function appendQuickReplies(buttons, onPick) {
    var wrap = document.createElement("div");
    wrap.className = "cw-quick-replies";
    buttons.forEach(function (btn) {
      var b = document.createElement("button");
      b.className = "cw-qr-btn";
      b.type = "button";
      b.textContent = btn.title;
      b.addEventListener("click", function () {
        Array.prototype.forEach.call(wrap.querySelectorAll(".cw-qr-btn"), function (other) {
          other.disabled = true;
        });
        b.classList.add("selected");
        onPick(btn);
      });
      wrap.appendChild(b);
    });
    els.thread.appendChild(wrap);
    els.body.scrollTop = els.body.scrollHeight;
    return wrap;
  }

  // ---- Real SDK message -> UI -----------------------------------------

  function extractQuickReplyButtons(message) {
    try {
      // Primary path, confirmed against live data: getQuickReplyData() is a
      // DIRECT method on ICMessage (returns this.quickReplyData) — it is
      // NOT nested under getInteractiveData() as originally assumed.
      var quickReply = message.getQuickReplyData && message.getQuickReplyData();
      var rawButtons = quickReply && quickReply.getButtons && quickReply.getButtons();

      // Fallback 1: some node types may still nest it under interactiveData.
      if (!rawButtons || !rawButtons.length) {
        var interactive = message.getInteractiveData && message.getInteractiveData();
        var nestedQuickReply = interactive && interactive.getQuickReplyData && interactive.getQuickReplyData();
        rawButtons = nestedQuickReply && nestedQuickReply.getButtons && nestedQuickReply.getButtons();
      }

      // Fallback 2: generic/form template attachments.
      if (!rawButtons || !rawButtons.length) {
        var attachments = message.getAttachments && message.getAttachments();
        if (attachments && attachments.length) {
          for (var i = 0; i < attachments.length; i++) {
            var att = attachments[i];
            var qr = att.getQuickReplyData && att.getQuickReplyData();
            var btns = qr && qr.getButtons && qr.getButtons();
            if (btns && btns.length) {
              rawButtons = btns;
              break;
            }
            var directBtns = att.getButtons && att.getButtons();
            if (directBtns && directBtns.length) {
              rawButtons = directBtns;
              break;
            }
          }
        }
      }

      if (!rawButtons || !rawButtons.length) return null;

      return rawButtons.map(function (b) {
        return {
          title: (b.getTitle && b.getTitle()) || (b.getValue && b.getValue()) || "Option",
          value: (b.getValue && b.getValue()) || (b.getPayload && b.getPayload()) || (b.getTitle && b.getTitle()),
        };
      });
    } catch (e) {
      console.warn("[widget] Could not parse quick-reply buttons from message", e);
      return null;
    }
  }

  function appendSystemNotice(text) {
    clearStatus();
    var row = document.createElement("div");
    row.className = "cw-status cw-system-notice";
    row.textContent = text;
    els.thread.appendChild(row);
    els.body.scrollTop = els.body.scrollHeight;
  }

  function renderIncomingMessage(message) {
    cancelDemoFallback();
    var type = (message.getType && message.getType()) || "Message";
    var text = (message.getMessage && message.getMessage()) || "";

    // Bridge customtags onto extras the same way Cisco's own production
    // widget does (imichatwidgetv2.js) — customtags is not automatically
    // part of extras; it has to be pulled in via getCustomTags() first.
    var extras = (message.getExtras && message.getExtras()) || {};
    if (message.getCustomTags) extras.customtags = message.getCustomTags();
    var customtags = extras.customtags || {};

    // ---- Sentinel-value protocol (confirmed against Cisco's own widget
    // source, not the generic ICMessageType enum) — this flow signals
    // system events via specific literal message text plus data riding
    // in customtags, rather than message.getType(). These must be checked
    // BEFORE falling through to normal text rendering, since the sentinel
    // text itself is never meant to be displayed.
    if (text === "$$$$$AGENTASSIGNED$$$$$") {
      var agentName = customtags.agent;
      if (customtags.typing === "typing_off") {
        hideTypingIndicator();
        appendSystemNotice(agentName ? "You're now connected with " + agentName + "." : "An agent has joined the conversation.");
      }
      return;
    }
    if (text === "$$$$$TYPING$$$$$") {
      if (customtags.typing === "typing_on") showTypingIndicator();
      else if (customtags.typing === "typing_off") hideTypingIndicator();
      return;
    }
    if (text === "$$$$CLOSECHAT$$$$" || text === "$$$$$AGENTCLOSECHAT$$$$") {
      if (!closeNoticeShown) {
        closeNoticeShown = true;
        appendSystemNotice("The agent has ended this conversation.");
      }
      icThread = null;
      hideTypingIndicator();
      return;
    }

    switch (type) {
      case "CloseThread":
        if (!closeNoticeShown) {
          closeNoticeShown = true;
          var closedThread = message.getThread && message.getThread();
          var reason = closedThread && closedThread.getReasonForStatusChange && closedThread.getReasonForStatusChange();
          if (reason) {
            appendSystemNotice(reason);
          } else {
            console.log("[widget] CloseThread arrived with no reasonForStatusChange — full thread object for inspection:", closedThread);
            appendSystemNotice(text || "This conversation has ended.");
          }
        }
        icThread = null; // force a fresh thread on next send
        return;

      case "ReopenThread":
        appendSystemNotice(text || "This conversation has been reopened.");
        return;

      case "ThreadAlert":
        appendSystemNotice(text || "Conversation updated.");
        return;

      case "TypingStart":
        showTypingIndicator();
        return;
      case "TypingStop":
        hideTypingIndicator();
        return;
      case "MessageDelivered":
      case "ReadReceipt":
      case "ClickedReceipt":
      case "MessageDeleted":
        // Not rendered in the transcript — status/meta events, not content.
        return;

      case "Message":
      default:
        hideTypingIndicator(); // a real message arriving implies typing stopped
        if (text) appendAgentBubble(text);

        var incomingAttachments = (message.getAttachments && message.getAttachments()) || (message.getMedia && message.getMedia());
        if (incomingAttachments && incomingAttachments.length) {
          incomingAttachments.forEach(function (att) {
            var url = att.getURL && att.getURL();
            if (!url) {
              // Shape didn't match what confirmed the outgoing path — log
              // it so the real accessor can be identified, same approach
              // used to nail down the quick-reply and upload-response shapes.
              console.log("[widget] Incoming attachment with no getURL() result — full object for inspection:", att);
              return;
            }
            appendIncomingAttachmentBubble(att, url);
          });
        }

        var buttons = extractQuickReplyButtons(message);
        if (buttons) {
          appendQuickReplies(buttons, function (btn) {
            appendUserBubble(btn.title);
            sendMessage(btn.title);
          });
        }
        return;
    }
  }

  function formatFileSize(bytes) {
    if (!bytes) return "";
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  }

  function appendIncomingAttachmentBubble(att, url) {
    clearStatus();
    var fileName = decodeURIComponent(url.split("/").pop().split("?")[0]) || "Attachment";
    var contentType = (att.getContentType && att.getContentType()) || "";
    var preview = att.getPreview && att.getPreview();
    var size = att.getSize && att.getSize();

    var row = document.createElement("div");
    row.className = "cw-row agent";
    var bubble = document.createElement("div");
    bubble.className = "cw-bubble cw-attachment-bubble";

    var link = document.createElement("a");
    link.href = url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.className = "cw-attachment-card";

    if (preview || /^image\//.test(contentType)) {
      var img = document.createElement("img");
      img.className = "cw-attachment-thumb";
      img.src = preview ? "data:" + (contentType || "image/jpeg") + ";base64," + preview : url;
      img.alt = fileName;
      link.appendChild(img);
    } else {
      var iconBox = document.createElement("span");
      iconBox.className = "cw-attachment-icon-box";
      iconBox.textContent = "📄";
      link.appendChild(iconBox);
    }

    var meta = document.createElement("span");
    meta.className = "cw-attachment-meta";
    var nameEl = document.createElement("span");
    nameEl.className = "cw-attachment-name";
    nameEl.textContent = fileName;
    meta.appendChild(nameEl);
    if (size) {
      var sizeEl = document.createElement("span");
      sizeEl.className = "cw-attachment-size";
      sizeEl.textContent = formatFileSize(size);
      meta.appendChild(sizeEl);
    }
    link.appendChild(meta);

    var downloadIcon = document.createElement("span");
    downloadIcon.className = "cw-attachment-download";
    downloadIcon.textContent = "⬇";
    link.appendChild(downloadIcon);

    bubble.appendChild(link);

    var time = document.createElement("div");
    time.className = "cw-time";
    time.textContent = nowLabel();

    row.appendChild(bubble);
    row.appendChild(time);
    els.thread.appendChild(row);
    els.body.scrollTop = els.body.scrollHeight;
  }

  // ---- Typing indicator (incoming) ---------------------------------------

  var typingRow = null;
  var typingAutoHideTimer = null;
  var TYPING_AUTO_HIDE_MS = 8000;

  function showTypingIndicator() {
    window.clearTimeout(typingAutoHideTimer);
    typingAutoHideTimer = window.setTimeout(hideTypingIndicator, TYPING_AUTO_HIDE_MS);
    if (typingRow) return;
    clearStatus();
    typingRow = document.createElement("div");
    typingRow.className = "cw-row agent";
    typingRow.innerHTML = '<div class="cw-bubble cw-typing"><span></span><span></span><span></span></div>';
    els.thread.appendChild(typingRow);
    els.body.scrollTop = els.body.scrollHeight;
  }

  function hideTypingIndicator() {
    window.clearTimeout(typingAutoHideTimer);
    if (typingRow) {
      typingRow.remove();
      typingRow = null;
    }
  }

  // ---- Sending -----------------------------------------------------------

  function sendMessage(text) {
    if (!text) return;
    if (!icThread) {
      // Thread was closed (inactivity timeout or End Conversation) — start
      // a fresh one automatically instead of silently dropping the message.
      createThread(function () {
        sendMessage(text);
      });
      return;
    }
    var messaging = IMI.ICMessaging.getInstance();
    var message = new IMI.ICMessage();
    message.setMessage(text);
    message.setThread(icThread);
    messaging.publishMessage(message, {
      onSuccess: function (msg) {
        console.log("message sent", msg);
      },
      onFailure: function (err) {
        console.log("failed to send message", err);
        appendAgentBubble("Sorry, that didn't send. Please try again.");
      },
    });
  }

  var typingPublishTimer = null;
  var isTypingPublished = false;

  function notifyTypingStarted() {
    if (!icThread) return;
    var messaging = IMI.ICMessaging.getInstance();
    if (!isTypingPublished) {
      isTypingPublished = true;
      messaging.publishTypingIndicator(icThread, true, {
        onSuccess: function () {},
        onFailure: function (err) {
          console.warn("[widget] publishTypingIndicator(true) failed", err);
        },
      });
    }
    // Debounce the "stopped typing" signal to 3s of inactivity.
    window.clearTimeout(typingPublishTimer);
    typingPublishTimer = window.setTimeout(notifyTypingStopped, 3000);
  }

  function notifyTypingStopped() {
    window.clearTimeout(typingPublishTimer);
    if (!icThread || !isTypingPublished) return;
    isTypingPublished = false;
    var messaging = IMI.ICMessaging.getInstance();
    messaging.publishTypingIndicator(icThread, false, {
      onSuccess: function () {},
      onFailure: function (err) {
        console.warn("[widget] publishTypingIndicator(false) failed", err);
      },
    });
  }

  function wireFooterInput() {
    function submit() {
      var val = els.input.value.trim();
      if (!val) return;
      notifyTypingStopped();
      hideTypingIndicator();
      appendUserBubble(val);
      sendMessage(val);
      els.input.value = "";
    }
    els.send.addEventListener("click", submit);
    els.input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") submit();
    });
    els.input.addEventListener("input", function () {
      if (els.input.value.trim()) notifyTypingStarted();
      else notifyTypingStopped();
    });
  }

  // ---- SDK lifecycle: startup -> register -> connect -> thread ----------

  function startChat() {
    if (typeof IMI === "undefined") {
      appendAgentBubble("Chat SDK failed to load. Check your network/allowlist settings.");
      return;
    }

    IMI.IMIconnect.startup();

    var messaging = IMI.ICMessaging.getInstance();
    messaging.setICMessagingReceiver({
      onConnectionStatusChanged: function (statusCode) {
        console.log("onConnectionStatusChanged", statusCode);
      },
      onMessageReceived: function (message) {
        renderIncomingMessage(message);
      },
    });

    function afterRegistered() {
      try {
        if (!messaging.isConnected()) messaging.connect();
      } catch (err) {
        // connect() can throw synchronously (e.g. SDK code 6003 "Feature not
        // supported" when shouldRequestNotificationPermission is true but no
        // Firebase SDK is loaded). Don't let that abort thread creation below.
        console.warn("[widget] messaging.connect() threw — continuing without live connection:", err);
      }
      createThread();
      // Demo auto-fallback disabled while debugging the real pipeline — it
      // was firing on any test session slower than 4s and silently masking
      // real send attempts (sendMessage() used to bail out once demo mode
      // kicked in). Re-enable once the flow is confirmed working end to end.
      // scheduleDemoFallback();
    }

    if (IMI.IMIconnect.isRegistered()) {
      // A device profile already exists in this browser (e.g. from an
      // earlier anonymous visit, before the customer logged in). Reusing
      // it silently skips the customerId logic below entirely — sync it
      // explicitly here so a returning, now-logged-in visitor isn't stuck
      // as an anonymous guest for the rest of the session.
      var existingLogin = window.AxisTestAuth && window.AxisTestAuth.getLoggedInCustomer();
      if (existingLogin) {
        messaging.updateCustomerId(existingLogin.customerId, {
          onSuccess: function () {
            console.log("[widget] synced customerId onto existing registration:", existingLogin.customerId);
          },
          onFailure: function (err) {
            console.warn("[widget] updateCustomerId (sync) failed", err);
          },
        });
      }
      afterRegistered();
    } else {
      // If the host page already has a logged-in customer (window.AxisTestAuth
      // is provided by test-login.js — swap this for ASL's real session check
      // in production), thread their customerId through at registration
      // instead of a fully anonymous guest ID.
      var loggedInCustomer = window.AxisTestAuth && window.AxisTestAuth.getLoggedInCustomer();
      var customerId = loggedInCustomer ? loggedInCustomer.customerId : null;
      var userId = customerId || ("guest-" + Date.now());
      var deviceId = userId + "-" + Date.now();
      var deviceProfile = new IMI.ICDeviceProfile(deviceId, userId, customerId, !customerId);
      IMI.IMIconnect.register(deviceProfile, {
        onSuccess: function () {
          afterRegistered();
        },
        onFailure: function (err) {
          console.log("registration failed", err);
          appendAgentBubble("Could not connect to chat right now. Please try again shortly.");
        },
      });
    }
  }

  // If the customer logs in (via test-login.js) AFTER chat has already
  // started as anonymous, bind their identity to the existing session
  // instead of requiring a full restart.
  document.addEventListener("axis:login", function (e) {
    if (typeof IMI === "undefined" || !chatStarted) return;
    IMI.ICMessaging.getInstance().updateCustomerId(e.detail.customerId, {
      onSuccess: function () {
        console.log("[widget] customer identity bound mid-session:", e.detail.customerId);
      },
      onFailure: function (err) {
        console.warn("[widget] updateCustomerId failed", err);
      },
    });
  });

  function createThread(onReady) {
    var thread = new IMI.ICThread();
    thread.setTitle("AxisDirect Support");
    thread.setStatus(IMI.ICThreadStatus.Active);
    thread.setType(IMI.ICThreadType.Conversation);
    var messaging = IMI.ICMessaging.getInstance();
    messaging.createThread(thread, {
      onSuccess: function (threadObj) {
        icThread = threadObj;
        closeNoticeShown = false;
        if (onReady) onReady(threadObj);
      },
      onFailure: function (err) {
        console.log("thread creation failed", err);
      },
    });
  }

  // ---- Demo fallback (clearly labelled, static, no live thread) ---------

  function scheduleDemoFallback() {
    demoTimer = window.setTimeout(function () {
      if (els.thread.children.length <= 1) renderDemoConversation();
    }, DEMO_FALLBACK_MS);
  }
  function cancelDemoFallback() {
    if (demoTimer) {
      window.clearTimeout(demoTimer);
      demoTimer = null;
    }
  }

  function renderDemoConversation() {
    usingDemoData = true;
    clearStatus();

    var tag = document.createElement("div");
    tag.className = "cw-status";
    tag.textContent = "Demo preview — no live flow response received yet";
    els.thread.appendChild(tag);

    appendAgentBubble("To start with your queries, kindly click on the below button.");
    appendQuickReplies(
      [
        { title: "Statements" },
        { title: "My Details" },
        { title: "Edit Profile" },
        { title: "Axis Bank queries" },
        { title: "How to trade" },
        { title: "Brokerage and Charges" },
        { title: "Any other query" },
      ],
      function (btn) {
        appendUserBubble(btn.title);
        if (btn.title === "Statements") {
          appendAgentBubble("Please select the statement type");
          appendQuickReplies(
            [{ title: "Demat Reports" }, { title: "Trading Reports" }, { title: "Tax Reports" }],
            function () {}
          );
        }
      }
    );
  }

  // ---- Language dropdown ---------------------------------------------
  // NOTE: this only changes the UI label right now. The SDK has no
  // conversation-language API of its own — navigator.language is sent
  // automatically at registration for analytics, but there's no method to
  // set a chat locale. Making the *bot* actually respond in the selected
  // language needs flow-side work (e.g. publish a hidden system message or
  // flow variable with the chosen language code and branch on it in Flow
  // Builder) — that's a design decision for whoever owns the flow, not
  // something this widget can decide unilaterally.
  function wireLanguageDropdown() {
    els.langToggle.addEventListener("click", function (e) {
      e.stopPropagation();
      els.langMenu.hidden = !els.langMenu.hidden;
    });
    Array.prototype.forEach.call(els.langMenu.querySelectorAll("button"), function (btn) {
      btn.addEventListener("click", function () {
        var label = btn.textContent.split(" ")[0];
        els.langToggle.firstChild.textContent = label + " ";
        Array.prototype.forEach.call(els.langMenu.querySelectorAll("button"), function (b) {
          b.classList.remove("active");
        });
        btn.classList.add("active");
        els.langMenu.hidden = true;
        console.log("[widget] Language selected in UI:", btn.dataset.lang, "— no SDK call exists to propagate this to the flow yet.");
      });
    });
    document.addEventListener("click", function () {
      els.langMenu.hidden = true;
    });
  }

  // ---- Emoji picker -----------------------------------------------------

  var EMOJI_SET = ["😀","😂","🙂","😍","👍","🙏","😊","😢","🎉","❤️","🤔","😅","👋","💰","📈","📉","✅","❌","📞","💬"];

  function buildEmojiPanel() {
    EMOJI_SET.forEach(function (emoji) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = emoji;
      btn.addEventListener("click", function () {
        els.input.value += emoji;
        els.input.focus();
        notifyTypingStarted();
      });
      els.emojiPanel.appendChild(btn);
    });
  }

  function wireEmojiPicker() {
    buildEmojiPanel();
    els.emojiToggle.addEventListener("click", function (e) {
      e.stopPropagation();
      els.emojiPanel.hidden = !els.emojiPanel.hidden;
    });
    document.addEventListener("click", function () {
      els.emojiPanel.hidden = true;
    });
  }

  // ---- Attachments --------------------------------------------------------
  // Uses IMI.ICMediaFileManager.uploadFile(file, mimeType, callback),
  // confirmed present in the shipped SDK bundle. The exact shape of the
  // onSuccess result hasn't been verified against a real upload yet — it's
  // logged in full below so the media-URL field name can be confirmed and
  // hardened on the next real test, same approach used to nail down the
  // quick-reply accessor earlier.
  function appendAttachmentBubble(fileName) {
    clearStatus();
    var row = document.createElement("div");
    row.className = "cw-row user";
    row.innerHTML =
      '<div class="cw-bubble cw-attachment-bubble"><span class="cw-attach-icon">📎</span><span></span></div><div class="cw-time"></div>';
    row.querySelector(".cw-attachment-bubble span:last-child").textContent = fileName;
    row.querySelector(".cw-time").textContent = nowLabel();
    els.thread.appendChild(row);
    els.body.scrollTop = els.body.scrollHeight;
  }

  var pendingUploads = []; // FIFO queue correlating uploads to their placeholder bubbles

  function wireGlobalUploadListener() {
    // The SDK's own uploadFile() onSuccess/onFailure callbacks don't
    // reliably fire even on a genuine successful upload (confirmed via
    // HAR). jQuery's ajaxComplete was tried as a workaround, but jQuery
    // itself isn't reliably present by the time this runs (CDN load
    // timing/extension interference). Intercepting native XHR directly
    // removes that dependency entirely — jQuery's own $.ajax ultimately
    // creates a native XHR under the hood, so this sees the same response
    // regardless of whether jQuery is loaded at all.
    var OriginalXHR = window.XMLHttpRequest;
    var originalOpen = OriginalXHR.prototype.open;
    var originalSend = OriginalXHR.prototype.send;

    OriginalXHR.prototype.open = function (method, url) {
      this.__cwUrl = url;
      return originalOpen.apply(this, arguments);
    };

    OriginalXHR.prototype.send = function () {
      var xhr = this;
      if (xhr.__cwUrl && xhr.__cwUrl.indexOf("/media/") !== -1 && xhr.__cwUrl.indexOf("/upload") !== -1) {
        xhr.addEventListener("load", function () {
          handleUploadResponse(xhr.responseText);
        });
      }
      return originalSend.apply(this, arguments);
    };
  }

  function handleUploadResponse(responseText) {
    var pending = pendingUploads.shift();
    if (!pending) return;

    var result;
    try {
      result = JSON.parse(responseText);
    } catch (e) {
      console.warn("[widget] Could not parse upload response", responseText);
      return;
    }
    console.log("[widget] upload response captured via XHR intercept:", result);

    if (result.code && result.code !== 36 && !result.file) {
      console.warn("[widget] Upload failed:", result.description || result);
      appendAgentBubble("Sorry, \"" + pending.fileName + "\" couldn't be uploaded (" + (result.description || "unknown error") + ").");
      return;
    }

    var mediaUrl = result.file;
    if (!mediaUrl || !icThread) return;

    // Must be a real ICMediaFile instance (which extends ICAttachment) —
    // a plain {url, type, name} object broke ICMessage.toJSON() internally,
    // since it calls .toJSON() on each media entry expecting a proper SDK
    // class instance. Confirmed against ICAttachment's own toJSON(): it only
    // serializes contentType, duration, latitude, longitude, size, preview,
    // url, and mediaId — there is no "name" field on this class at all, so
    // setName() doesn't exist here. The filename travels via the message
    // text instead (already set below via setMessage).
    var mediaFile = new IMI.ICMediaFile();
    mediaFile.setURL(mediaUrl);
    mediaFile.setContentType(pending.fileType);
    if (result.mediaId) mediaFile.setMediaId(result.mediaId);
    if (result.preview) mediaFile.setPreview(result.preview);
    if (pending.fileSize) mediaFile.setSize(pending.fileSize);

    var message = new IMI.ICMessage();
    message.setMessage(pending.fileName);
    message.setThread(icThread);
    message.setMedia([mediaFile]);
    IMI.ICMessaging.getInstance().publishMessage(message, {
      onSuccess: function () {
        console.log("[widget] attachment message sent");
      },
      onFailure: function (err) {
        console.warn("[widget] failed to send attachment message", err);
      },
    });
  }

  function wireAttachments() {
    els.attachToggle.addEventListener("click", function () {
      els.fileInput.click();
    });
    els.fileInput.addEventListener("change", function () {
      var file = els.fileInput.files && els.fileInput.files[0];
      els.fileInput.value = "";
      if (!file) return;
      if (!icThread) {
        appendAgentBubble("Chat isn't connected yet — please try attaching again in a moment.");
        return;
      }
      if (typeof IMI === "undefined" || !IMI.ICMediaFileManager) {
        appendAgentBubble("Attachment upload isn't available right now.");
        return;
      }

      appendAttachmentBubble(file.name);
      pendingUploads.push({ fileName: file.name, fileType: file.type, fileSize: file.size });

      // Use the SDK's own uploadFile() so the correct auth header (attached
      // internally via the SDK's private _getAjaxHeader()) is sent — the
      // actual response is picked up via wireGlobalUploadListener() above,
      // not via this call's own onSuccess/onFailure.
      IMI.ICMediaFileManager.uploadFile(file, file.type, {
        onFileUploadProgress: function (f, loaded, total) {
          console.log("[widget] upload progress", loaded, "/", total);
        },
        onSuccess: function () {},
        onFailure: function () {},
      });
    });
  }

  // ---- End Conversation ---------------------------------------------------

  function wireEndChat() {
    els.endChat.addEventListener("click", function () {
      if (!icThread) {
        appendSystemNotice("There's no active conversation to end.");
        return;
      }
      appendSystemNotice("Are you sure you want to end this conversation?");
      appendQuickReplies(
        [{ title: "Yes, end chat" }, { title: "No, continue" }],
        function (btn) {
          if (btn.title === "No, continue") return;

          var messaging = IMI.ICMessaging.getInstance();
          var threadId = icThread.getId ? icThread.getId() : null;

          // Publish an explicit, flow-catchable message FIRST, so a flow
          // node can react to it if one is ever built to close/resolve the
          // linked WxCC task server-side.
          var endMessage = new IMI.ICMessage();
          endMessage.setMessage("Customer ended the chat");
          endMessage.setThread(icThread);
          messaging.publishMessage(endMessage, {
            onSuccess: function () {
              console.log("[widget] end-chat signal sent to flow");
            },
            onFailure: function (err) {
              console.warn("[widget] failed to send end-chat signal", err);
            },
          });

          // Close the thread using the exact pattern confirmed from Cisco's
          // own production widget source (imichatwidgetv2.js) — it does NOT
          // reuse the live thread instance or call the generic closeThread()
          // helper. It builds a fresh ICThread with just id/title/type/status
          // plus setReasonForStatusChange(), which our earlier closeThread()
          // call never set.
          if (threadId) {
            var closingThread = new IMI.ICThread();
            closingThread.setId(threadId);
            closingThread.setTitle("AxisDirect Support");
            closingThread.setType(IMI.ICThreadType.Conversation);
            closingThread.setStatus(IMI.ICThreadStatus.Closed);
            closingThread.setReasonForStatusChange("Customer ended the conversation");
            messaging.updateThread(closingThread, {
              onSuccess: function () {
                console.log("[widget] conversation closed by customer");
              },
              onFailure: function (err) {
                console.warn("[widget] updateThread (close) failed", err);
              },
            });
          }

          appendSystemNotice("You've ended this conversation. Send a message anytime to start a new one.");
          icThread = null;
          hideTypingIndicator();
          notifyTypingStopped();
        }
      );
    });
  }

  // ---- Init ---------------------------------------------------------------

  document.addEventListener("DOMContentLoaded", function () {
    cacheEls();
    els.launcher.addEventListener("click", openPanel);
    els.minimize.addEventListener("click", closePanel);
    els.close.addEventListener("click", closePanel);
    wireFooterInput();
    wireLanguageDropdown();
    wireEmojiPicker();
    wireGlobalUploadListener();
    wireAttachments();
    wireEndChat();
  });
})();
