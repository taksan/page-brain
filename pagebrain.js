// ==UserScript==
// @name         Page brAIn
// @namespace    https://github.com/taksan/page-brain
// @version      1.1
// @description  Page brAIn is an assistant to aid with the current page content
// @author       Takeuchi
// @grant        GM_download
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM.setValue
// @grant        GM.getValue
// @grant        GM.deleteValue
// @require      https://cdnjs.cloudflare.com/ajax/libs/marked/4.3.0/marked.min.js
// ==/UserScript==
(async function() {
    'use strict';
    
    let CHAT_MODAL = null
    let messageHistory = null
    
    const defaultConfig = {
        "llm": null,
        "prompt": `You are a helpful assistant with the ability to answer questions about the current page content.`,
        "chat_url": "http://localhost:11434/api/chat",
        "models_url": "http://localhost:11434/api/tags"
    }    
    async function main() {
        let config = await GM.getValue("config", defaultConfig)
        messageHistory = new ChatHistory(config)

        let theShadowRoot = createShadowRoot();
        addStyling(theShadowRoot);
        addTypingStyle(theShadowRoot)
        let assistantButton = createAssistantButton(theShadowRoot)
        CHAT_MODAL = new ChatModal(theShadowRoot, assistantButton, messageHistory, config)
        if (!config.llm) {
            initConfig(config, CHAT_MODAL)
            return
        }
        messageHistory.init()
    }

    class ChatHistory {
        constructor(config) {
            this.history = []
            this.config = config
        }
        
        async init() {
            this.history = [{role: "system", content: this.config.prompt}]
            this.userMessage("This is the current page content: \n" + getPageContent())
        }

        aiMessage(message) {
            this.history.push({role: "assistant", content: message})
        }

        userMessage(message) {
            this.history.push({role: "user", content: message})
        }

        lastMessage() {
            return this.history[this.history.length - 1]
        }
        getHistory() {
            return this.history
        }
    }
    class ChatModal {
        constructor(shadowRoot, chatOpenButton, messageHistory, config) {
            this.messageHistory = messageHistory
            this.config = config
            this.chatOpenButton = chatOpenButton;
            this.createElements(shadowRoot);
            this.setupEventListeners();
            this.currentPreProcessPromptFunction = this.defaultPreProcessPrompt;
            this.addAssistantMessage("Type '/overview' to get an overview of the page content or /help to see the commands");
        }

        createElements(shadowRoot) {
            this.chatOverlay = document.createElement('div');
            this.chatOverlay.className = 'modal-overlay';

            this.modal = document.createElement('div');
            this.modal.className = 'chat-modal';

            this.closeBtn = document.createElement('button');
            this.closeBtn.className = 'close-button';
            this.closeBtn.innerHTML = '×';

            this.chatContent = document.createElement('div');
            this.chatContent.className = 'chat-content';

            this.inputArea = document.createElement('div');
            this.inputArea.className = 'chat-input-area';

            this.chatInput = document.createElement('input');
            this.chatInput.className = 'chat-input';
            this.chatInput.type = 'text';
            this.chatInput.placeholder = 'Ask a question about the page...';

            this.sendBtn = document.createElement('button');
            this.sendBtn.className = 'chat-send-btn';
            this.sendBtn.innerText = 'Send';

            // Assemble the components
            this.inputArea.appendChild(this.chatInput);
            this.inputArea.appendChild(this.sendBtn);

            this.modal.appendChild(this.closeBtn);
            this.modal.appendChild(this.chatContent);
            this.modal.appendChild(this.inputArea);

            this.chatOverlay.appendChild(this.modal);
            shadowRoot.appendChild(this.chatOverlay);

            ignoreKeyStrokesWhenInputHasFocus(shadowRoot, this.chatInput);
        }

        setupEventListeners() {
            this.closeBtn.onclick = () => this.closePanel();
            this.sendBtn.addEventListener('click', () => this.sendMessage());
            this.chatInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    this.sendMessage();
                }
            });
        }

        showPanel(selection) {
            this.chatOverlay.classList.add('visible');
            this.chatOpenButton.hide();
            let selectedText = selection?.toString();
            console.log("Selected text: " + selectedText);
            
            if (!selectedText) {
                this.chatInput.focus();
                return null;
            }
            
            this.messageHistory.userMessage(`
                I have the following selected text and I may ask questions or discuss it.
                ----
                ${selectedText}
                ----
                `);
            
            this.addAssistantMessage(`You have selected text. Feel free to ask questions or discuss it.`);
            this.chatInput.focus();
        }

        closePanel() {
            this.chatOverlay.classList.remove('visible');
            this.chatOpenButton.show();
        }

        scrollToBottom() {
            this.chatContent.scrollTop = this.chatContent.scrollHeight;
        }

        addAssistantMessage(content) {
            const contentMessage = document.createElement('div');
            contentMessage.className = 'chat-message assistant';
            contentMessage.innerHTML = marked.parse(content);
            this.chatContent.appendChild(contentMessage);
            this.messageHistory.aiMessage(content);
            this.scrollToBottom();
        }

        addUserMessage(content) {
            const userMessageEl = document.createElement('div');
            userMessageEl.className = 'chat-message user';
            userMessageEl.textContent = content;
            this.chatContent.appendChild(userMessageEl);
            this.scrollToBottom();
        }

        addNoLLMMessage(content) {
            const contentMessage = document.createElement('div');
            contentMessage.className = 'chat-message assistant';
            if (content instanceof HTMLElement)
                contentMessage.appendChild(content);
            else
                contentMessage.innerHTML = marked.parse(content);
            this.chatContent.appendChild(contentMessage);
            this.scrollToBottom();
        }

        async sendMessage() {
            const userMessage = this.chatInput.value.trim();
            if (!userMessage) return;


            this.addUserMessage(userMessage);
            this.chatInput.value = '';

            if (!this.config.llm) {
                this.config.llm = userMessage;                
                this.addAssistantMessage("I have selected the following LLM: " + this.config.llm);
                this.messageHistory.init()
                return;
            }

            let query = userMessage;
            query = this.currentPreProcessPromptFunction(userMessage);
            if (!query)
                return

            await this.sendChatMessage(query);
        }

        async sendChatMessage(query) {
            this.chatInput.disabled = true;
            this.sendBtn.disabled = true;
            const typingIndicator = createTypingIndicator();
            this.chatContent.appendChild(typingIndicator);

            try {
                messageHistory.userMessage(query)
                const data = await sendQuery(this.config, messageHistory);


                let toolAnswer = handleToolCalls(data.message.tool_calls);
                if (toolAnswer) {
                    console.log("toolAnswer: " + toolAnswer);
                    console.log(this.messageHistory.lastMessage());
                    this.addAssistantMessage(toolAnswer);
                } else {
                    this.addAssistantMessage(data.message.content);
                }
            } catch (error) {
                console.error('Error:', error);
                this.addAssistantMessage("An error occurred while processing your request.");
            } finally {
                if (this.chatContent.contains(typingIndicator)) {
                    this.chatContent.removeChild(typingIndicator);
                }
                this.scrollToBottom();
                this.chatInput.disabled = false;
                this.sendBtn.disabled = false;
                this.chatInput.focus();
            }
        }

        defaultPreProcessPrompt(userInput) {
            switch(userInput.toLowerCase().trim()) {
                case '/help':
                    this.addNoLLMMessage("commands: /help, /overview, /reset, /config");
                    return null
                    
                case "/overview":
                    return summarizePrompt();

                case "/config":
                    this.addNoLLMMessage("The current configuration is:\n ```json\n" + JSON.stringify(this.config, null, 2) + "\n```");
                    return null

                case "/reset":
                    GM.deleteValue("config")
                    this.config = defaultConfig
                    initConfig(this.config, this)
                    return null
                
                default:
                    return userInput;
            }
        }
    }    


    async function initConfig(config, chatModal) {
        chatModal.addNoLLMMessage("There is no LLM selected. Choose one from the following (click on it): ")
        await chooseModel(config, selectLLM, chatModal);
    }

    function selectLLM(config, model, chatModal) {
        chatModal.addAssistantMessage("You selected selected the following LLM: " + model)
        config.llm = model
        GM.setValue("config", config)
        messageHistory.init()
    }


    function createShadowRoot() {
        const container = document.createElement('div');
        container.style.all = 'initial';
        container.style.position = 'fixed';
        container.style.zIndex = '9999';
        document.body.appendChild(container);

        return container.attachShadow({mode: 'open'});
    }


    function openChat(selection) {
        CHAT_MODAL.showPanel(selection)
    }

    function summarizePrompt() {
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

    async function sendQuery(config, messageHistory) {
        let req = {
            "model": config.llm,
            "stream": false,
            "messages": messageHistory.getHistory(),
            "tools": []
        }


        // Send the request
        const response = await fetch(`${config.chat_url}`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(req)
            });
        if (!response.ok) {
            throw new Error('Failed to communicate with LLM!! \n' + response.statusText);
        }
        return await response.json();
    }

    function createAssistantButton(shadowRoot) {
        let openBrain = document.createElement('button');
        openBrain.id = 'assistant-btn';
        openBrain.innerText = '✨';
        openBrain.title = 'Talk about page content';

        // Add ESC key listener for closing panel
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                CHAT_MODAL?.closePanel()
            }
        });

        // Drag functionality variables
        let dragStarted = false;
        let currentX, currentY, initialX, initialY;
        let xOffset = 0;
        let yOffset = 0;

        // Drag event listeners
        openBrain.addEventListener('mousedown', dragStart);
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

            if (e.target === openBrain) {
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

                setTranslate(currentX, currentY, openBrain);
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
            openBrain.classList.add('hidden');
        }

        function show() {
            openBrain.classList.remove('hidden');
        }

        shadowRoot.appendChild(openBrain);
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


    function ignoreKeyStrokesWhenInputHasFocus(shadowRoot, inputElement) {
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

    async function chooseModel(config, selectLLM, chatModal) {
        try {
            let response = await fetch(`${config.models_url}`).then(res => res.json());
            let ul = document.createElement('ul');
            ul.classList.add('llm-list');
            response.models.forEach(m => {
                let li = document.createElement('li');
                li.innerHTML = m.model;
                li.onclick = () => selectLLM(config, m.model, chatModal);
                ul.appendChild(li);
            });
            chatModal.addNoLLMMessage(ul);
        } catch (e) {
            chatModal.addNoLLMMessage("Failed to fetch models: " + e);
        }
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

            .chat-modal {
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
            .llm-list {
                cursor: pointer;
            }
            .llm-list li:hover {
                background-color: #f0f0f0;
            }
        `;
        shadowRoot.appendChild(style);
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

    function handleToolCalls(toolCalls) {
        if (!toolCalls || toolCalls.length === 0)
            return false
        // console.log("Tool calls: " + JSON.stringify(toolCalls))
        // for (let toolCall of toolCalls) {
        //     if (toolCall.function.name === "get_assistant_configuration") {
        //         return "The current configuration is: " + get_assistant_configuration()
        //     }
        //     else
        //     if (toolCall.function.name === "reply_to_user") {
        //         return reply_to_user(toolCall.function.arguments.message)
        //     }
        //     else {
        //         console.log("Unknown tool call: " + toolCall.function.name)
        //         console.log(toolCall.function.arguments.keys())
        //     }
        // }
        return false
    }


    main()
})();
