// ==UserScript==
// @name         Page brAIn
// @namespace    https://github.com/taksan/page-brain
// @version      1.1
// @description  Page brAIn is an assistant to aid with the current page content
// @author       Takeuchi
// @grant        GM_download
// @grant        GM_setValue
// @grant        GM_getValue
// @require      https://code.jquery.com/jquery-3.7.1.slim.min.js
// @require      https://cdnjs.cloudflare.com/ajax/libs/markdown.js/0.5.0/markdown.min.js
// ==/UserScript==
(function() {
    'use strict';

    let shadowRoot = null;
    let chatModal = null
    let assistantButton = null;
    let messageHistory = []

    function main() {
        shadowRoot = createShadowRoot();
        addStyling(shadowRoot);
        addTypingStyle(shadowRoot)
        assistantButton = createAssistantButton(shadowRoot)
        messageHistory.push({role: "system", content: "You are a helpful assistant."})
        messageHistory.push({role: "user", content: "This is the current page content: \n" + getPageContent()})
    }

    function createShadowRoot() {
        const container = document.createElement('div');
        container.style.all = 'initial';
        container.style.position = 'fixed';
        container.style.zIndex = '9999';
        document.body.appendChild(container);

        return container.attachShadow({mode: 'open'});
    }

    function addStyling(shadowRoot) {
        const style = document.createElement('style');
        style.textContent = `
            :host {
                all: initial;
                font-family: Arial, sans-serif;
            }
            #assistant-btn {
                position: fixed;
                bottom: 50vh;
                right: 12px;
                z-index: 1000;
                padding: 10px 15px;
                background-color: #ff0000;
                color: white;
                border: none;
                border-radius: 5px;
                font-size: 14px;
                cursor: pointer;
                opacity: 0.3;
            }
            #assistant-btn:hover {
                background-color: #cc0000;
                opacity: 1.0;
            }
            #assistant-btn.hidden {
                display: none !important;
            }

            .summary-modal {
                position: fixed;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                background-color: white;
                border-radius: 8px;
                box-shadow: 0 2px 10px rgba(0,0,0,0.1);
                z-index: 1001;
                width: 80%;
                max-width: 600px;
                height: 70vh;
                display: flex;
                flex-direction: column;
            }

            .chat-content {
                flex-grow: 1;
                overflow-y: auto;
                padding: 15px;
                border-bottom: 1px solid #e0e0e0;
                margin-top: 24px;
                max-height: calc(70vh - 150px);
            }

            .chat-message {
                margin-bottom: 10px;
                padding: 10px;
                border-radius: 8px;
            }

            .chat-message.user {
                background-color: #f0f0f0;
                text-align: right;
            }

            .chat-message.assistant {
                background-color: #e6f2ff;
            }

            .chat-message.assistant,
            .chat-message.assistant * {
                max-width: 100%;
                word-wrap: break-word;
            }

            .chat-input-area {
                display: flex;
                padding: 10px;
            }

            .chat-input {
                flex-grow: 1;
                padding: 10px;
                border: 1px solid #ddd;
                border-radius: 4px;
                margin-right: 10px;
            }

            .chat-send-btn {
                padding: 10px 15px;
                background-color: #007bff;
                color: white;
                border: none;
                border-radius: 4px;
                cursor: pointer;
            }

            .modal-overlay {
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background-color: rgba(0,0,0,0.5);
                z-index: 1000;
                display: none;
            }

            .modal-overlay.visible {
                display: flex;
                justify-content: center;
                align-items: center;
            }

            .close-button {
                position: absolute;
                top: 10px;
                right: 10px;
                background: none;
                border: 1px solid #666;
                font-size: 12px;
                cursor: pointer;
                color: #666;
                z-index: 1002;
                border-radius: 8px;
            }

            .close-button:hover {
                color: #000;
                background: aliceblue;
            }
        `;
        shadowRoot.appendChild(style);
    }

    // Function to create chat modal within shadow root
    function createChatModal() {
        function showPanel(selection) {
            chatOverlay.classList.add('visible');
            assistantButton.hide()
            let selectedText = selection?.toString()
            console.log("Selected text: " + selectedText)
            if (!selectedText)
                return null

            addAssistantMessage(`You have selected text. Would you like to discuss or ask questions about it?`,
                explainContent(selectedText));

            chatInput.focus();
        }

        function scrollToBottom() {
            chatContent.scrollTop = chatContent.scrollHeight;
        }

        function closePanel() {
            chatOverlay.classList.remove('visible');
            assistantButton.show()
        }

        function explainContent(content) {
            let contentToExplain = content
            return (userInput) => {
                if (isConfirmation(userInput)) {
                    return `
                   Use the following selected content to answer or debate:

                   ----
                   ${contentToExplain}
                   ----
                   `
                }
                return null
            }
        }

        function addAssistantMessage(content, preProcessPromptFunction = (userInput) => null) {
            const contentMessage = document.createElement('div');
            contentMessage.className = 'chat-message assistant';
            contentMessage.innerHTML = markdown.toHTML(content);
            chatContent.appendChild(contentMessage);
            currentPreProcessPromptFunction = preProcessPromptFunction
            messageHistory.push({role: "assistant", content: content})
        }

        function addUserMessage(content) {
            // Add user message to chat
            const userMessageEl = document.createElement('div');
            userMessageEl.className = 'chat-message user';
            userMessageEl.textContent = content
            chatContent.appendChild(userMessageEl);
        }

        // Function to handle sending a message
        function sendMessage() {
            const userMessage = chatInput.value.trim();
            if (!userMessage) return;

            addUserMessage(userMessage)

            // Clear input
            chatInput.value = '';

            scrollToBottom()

            let query = userMessage

            let newPrompt = currentPreProcessPromptFunction(userMessage);
            currentPreProcessPromptFunction = (userInput) => null
            if (newPrompt)
                query = newPrompt

            sendChatMessage(query)
        }

        function sendChatMessage(msg) {
            // Disable input while processing
            chatInput.disabled = true;
            sendBtn.disabled = true;
            const typingIndicator = createTypingIndicator();
            chatContent.appendChild(typingIndicator);

            return sendQuery(msg)
                .then(data => {
                    addAssistantMessage(data.message.content)
                })
                .catch(error => {
                    console.error('Error:', error);
                    addAssistantMessage(data.message.content)
                })
                .finally(() => {
                    if (chatContent.contains(typingIndicator)) {
                        chatContent.removeChild(typingIndicator);
                    }
                    scrollToBottom()

                    // Re-enable input
                    chatInput.disabled = false;
                    sendBtn.disabled = false;
                    chatInput.focus();
                })
        }
        // setup
        let chatOverlay = document.createElement('div');
        chatOverlay.className = 'modal-overlay visible';

        const modal = document.createElement('div');
        modal.className = 'summary-modal';

        const closeBtn = document.createElement('button');
        closeBtn.className = 'close-button';
        closeBtn.innerHTML = '×';
        closeBtn.onclick = closePanel;

        const chatContent = document.createElement('div');
        chatContent.className = 'chat-content';

        const inputArea = document.createElement('div');
        inputArea.className = 'chat-input-area';

        const chatInput = document.createElement('input');
        chatInput.className = 'chat-input';
        chatInput.type = 'text';
        chatInput.placeholder = 'Ask a question about the page...';
        ignoreKeyStrokesWhenInputHasFocus(chatInput)

        const sendBtn = document.createElement('button');
        sendBtn.className = 'chat-send-btn';
        sendBtn.innerText = 'Send';

        // Add event listeners for sending message
        sendBtn.addEventListener('click', sendMessage);
        chatInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                sendMessage();
            }
        });

        inputArea.appendChild(chatInput);
        inputArea.appendChild(sendBtn);

        modal.appendChild(closeBtn);
        modal.appendChild(chatContent);
        modal.appendChild(inputArea);

        chatOverlay.appendChild(modal);
        shadowRoot.appendChild(chatOverlay);

        // Focus on input
        chatInput.focus();

        // Hide the button when panel is shown
        assistantButton.hide()

        let currentPreProcessPromptFunction = (_userInput) => null
        addAssistantMessage("Would you like an overview? (type yes if so)", (userInput) => {
            if (isConfirmation(userInput)) {
                return summarize()
            }
            return null
        });
        return {
            showPanel: showPanel,
            closePanel: closePanel
        }
    }


    function openChat(selection) {
        if (chatModal) {
            chatModal.showPanel(selection);
            return;
        }
        chatModal = createChatModal(selection)
    }

    function summarize() {
        return `
        Summarize the page content, focus on the main story. Structure the summary as follows:
        - Add a short introduction about the general subject of the page
        - Create an outline of the main topics, similar to a table of contents
        - Explore the main topics shortly as bullet points with a short explanation of each topic
        - If a topic is about an external story, include a link to the story, use markdown links
        - When creating outlines, dont add empty topics and dont add duplicate topics
        - Draw no conclusions, just write the summary
        `;
    }

    function sendQuery(query) {
        messageHistory.push({role: "user", content: query})
        console.log(messageHistory)
        let req = {
            "model": "llama3.2:3b-32k",
            "stream": false,
            "messages": messageHistory
        }

        // Send the request
        return fetch('http://localhost:11434/api/chat', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(req)
        })
            .then(response => {
                if (!response.ok) {
                    throw new Error('Network response was not ok!! \n' + response.statusText);
                }
                return response.json()
            })
    }

    function createAssistantButton(shadowRoot) {
        // Create the button
        let assistantButton = document.createElement('assistantButton');
        assistantButton.id = 'assistant-btn';
        assistantButton.innerText = '✨';
        assistantButton.title = 'Talk about page content';

        // Add ESC key listener for closing panel
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                chatModal?.closePanel()
            }
        });

        // Drag functionality variables
        let dragStarted = false;
        let currentX, currentY, initialX, initialY;
        let xOffset = 0;
        let yOffset = 0;

        // Drag event listeners
        assistantButton.addEventListener('mousedown', dragStart);
        document.addEventListener('mousemove', drag);
        document.addEventListener('mouseup', dragEnd);

        let currentSelection = null
        function dragStart(e) {
            if (window.getSelection().rangeCount > 0)
                currentSelection = window.getSelection().getRangeAt(0).cloneRange()

            initialX = e.clientX - xOffset;
            initialY = e.clientY - yOffset;
            currentX = initialX;
            currentY = initialY;

            if (e.target === assistantButton) {
                dragStarted = true;
            }
        }

        function drag(e) {
            if (dragStarted) {
                e.preventDefault();
                currentX = e.clientX - initialX;
                currentY = e.clientY - initialY;

                xOffset = currentX;
                yOffset = currentY;

                setTranslate(currentX, currentY, assistantButton);
            }
        }

        function setTranslate(xPos, yPos, el) {
            el.style.transform = `translate3d(${xPos}px, ${yPos}px, 0)`;
        }

        function dragEnd() {
            if (dragStarted) {
                dragStarted = false;
                if (Math.abs(currentX - initialX) < 5 && Math.abs(currentY - initialY) < 5) {
                    openChat(currentSelection);
                    return;
                }

                initialX = currentX;
                initialY = currentY;
            }
        }

        function hide() {
            assistantButton.classList.add('hidden');
        }

        function show() {
            assistantButton.classList.remove('hidden');
        }

        // Append the assistantButton to the shadow root
        shadowRoot.appendChild(assistantButton);
        return {
            hide: hide,
            show: show
        }
    }

    function getPageContent() {
        // Create a temporary div to hold the page content
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = document.body.innerHTML;

        // Remove all script and style tags
        const scriptsAndStyles = tempDiv.querySelectorAll('script, style');
        scriptsAndStyles.forEach(element => element.remove());

        // Function to process a node and its children
        function processNode(node) {
            if (node.nodeType === Node.ELEMENT_NODE) {
                // If it's a link, preserve it
                if (node.tagName === 'A' && node.href) {
                    return `[${node.textContent}](${node.href}) `;
                }

                // For other elements, process their children
                let text = '';
                for (let child of node.childNodes) {
                    text += processNode(child);
                }
                return text;
            } else if (node.nodeType === Node.TEXT_NODE) {
                // Return text content for text nodes
                return node.textContent;
            }
            return '';
        }

        return processNode(tempDiv);
    }


    function isConfirmation(message) {
        return ['yes', 'y', 'yeah', 'please'].includes(message.toLowerCase().trim())
    }

    ///////////////////////
    function ignoreKeyStrokesWhenInputHasFocus(inputElement) {
        function stopPropagation(e) {
            // Check if the input is actually focused
            if (shadowRoot.activeElement !== inputElement) return
            if (e.key === 'Escape' || e.key === 'Enter') return

            e.stopImmediatePropagation();
            e.stopPropagation();
        }

        // List of events to capture and potentially stop
        const eventsToCapture = [
            'keydown',
            'keyup',
            'keypress',
            'input'
        ];

        function attachListeners() {
            eventsToCapture.forEach(eventType => {
                document.addEventListener(eventType, stopPropagation, {
                    capture: true,  // Use capturing phase to intercept events early
                    passive: false  // Ensure we can call stopPropagation
                });
            });
        }

        function removeListeners() {
            eventsToCapture.forEach(eventType => {
                document.removeEventListener(eventType, stopPropagation, {
                    capture: true
                });
            });
        }

        // Attach listeners when input is focused
        inputElement.addEventListener('focus', attachListeners);

        // Remove listeners when input loses focus
        inputElement.addEventListener('blur', removeListeners);

        // Optional: Add direct event listeners to the input
        inputElement.addEventListener('keydown', (e) => {
            // Prevent default for specific keys if needed
            if (e.key === 'Escape') {
                inputElement.blur();
            }
        });
    }


    function createTypingIndicator() {
        const typingContainer = document.createElement('div');
        typingContainer.className = 'typing-indicator chat-message assistant';
        typingContainer.innerHTML = `
            <div class="typing-dots">
                <span class="dot"></span>
                <span class="dot"></span>
                <span class="dot"></span>
            </div>
        `;
        return typingContainer;
    }

    function addTypingStyle(shadowRoot) {
        const style = document.createElement('style');
        style.textContent = `
            .typing-indicator {
                display: flex;
                justify-content: center;
                align-items: center;
                padding: 10px;
                background-color: #f0f0f0;
                border-radius: 8px;
                margin: 10px 0;
            }

            .typing-dots {
                display: flex;
                gap: 8px;
            }

            .dot {
                width: 8px;
                height: 8px;
                background-color: #666;
                border-radius: 50%;
                animation: typing 1.4s infinite;
                opacity: 0.6;
            }

            .dot:nth-child(2) {
                animation-delay: 0.2s;
            }

            .dot:nth-child(3) {
                animation-delay: 0.4s;
            }

            @keyframes typing {
                0%, 100% { opacity: 0.6; transform: translateY(0); }
                50% { opacity: 1; transform: translateY(-4px); }
            }
        `;
        shadowRoot.appendChild(style);
    }


    main()
})();