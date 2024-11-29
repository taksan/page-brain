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
        "chat_url": "http://localhost:11434/v1/chat/completions",
        "models_url": "http://localhost:11434/v1/models"
    }
    const commonConfigs = {
        "groq": {
            "chat_url": "https://api.groq.com/v1/chat/completions",
            "models_url": "https://api.groq.com/v1/models"
        },
        "ollama": {
            "chat_url": "http://localhost:11434/v1/chat/completions",
            "models_url": "http://localhost:11434/v1/models"
        }
    }
    const availableTools = [
        {
            "function": {
                "name": "get_assistant_configuration",
                "description": "Get the current assistant configuration"
            },
            "type": "function"
        }
    ]
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
            this.currentPreProcessPromptFunction = this.defaultPreProcessPrompt;
            this.addAssistantMessage("Type '/overview' to get an overview of the page content or /help to see the commands");
        }

        createElements(shadowRoot) {
            this.chatOverlay = document.createElement('div');
            this.chatOverlay.className = 'modal-overlay';

            this.modal = document.createElement('div');
            this.modal.className = 'chat-modal';
            this.chatOverlay.appendChild(this.modal);
            shadowRoot.appendChild(this.chatOverlay);

            this.modal.appendChild(createHeaderArea(this))
            this.configPanel = createConfigPanel(this)
            this.modal.appendChild(this.configPanel)
            
            this.chatContent = createChatMessageArea();
            this.modal.appendChild(this.chatContent);

            let {userInput, sendBtn, userInputArea} = createUserInputArea(this)
            this.modal.appendChild(userInputArea);
            this.userInput = userInput
            this.sendBtn = sendBtn
            this.userInputArea = userInputArea


            function createChatMessageArea() {
                let chatContent = document.createElement('div');
                chatContent.className = 'chat-content';
                return chatContent
            }

            function createUserInputArea(self) {
                const userInputArea = document.createElement('div');
                userInputArea.className = 'chat-input-area';

                let userInput = document.createElement('input')
                userInput.className = 'chat-input';
                userInput.type = 'text';
                userInput.placeholder = 'Ask a question about the page...';
                userInput.addEventListener('keypress', (e) => {
                    if (e.key === 'Enter') {
                        self.sendMessage();
                    }
                });

                let sendBtn = document.createElement('button');
                sendBtn.className = 'chat-send-btn';
                sendBtn.innerText = 'Send';
                sendBtn.addEventListener('click', () => self.sendMessage());

                userInputArea.appendChild(userInput);
                userInputArea.appendChild(sendBtn);
                ignoreKeyStrokesWhenInputHasFocus(shadowRoot, userInput);
                
                return {userInput, sendBtn, userInputArea}
            }

            function createHeaderArea(self) {
                let headerArea = document.createElement('div');
                headerArea.className = 'chat-header';
                
                let configBtn = document.createElement('button');
                configBtn.className = 'config-button';
                configBtn.innerHTML = '⚙️';
                configBtn.title = 'Configure';
                
                let closeBtn = document.createElement('button');
                closeBtn.className = 'close-button';
                closeBtn.innerHTML = '×';
                closeBtn.onclick = () => self.closePanel();
                
                headerArea.appendChild(configBtn);
                headerArea.appendChild(closeBtn);
                configBtn.addEventListener('click', () => self.showConfigPanel());
                return headerArea
            }

            function createConfigPanel(self) {
                // Create config panel
                const configPanel = document.createElement('div');
                configPanel.className = 'config-panel';
                configPanel.style.display = 'none';
                const configForm = document.createElement('form');
                configForm.innerHTML = `
                <h3>Configuration</h3>
                <div class="config-field">
                    <label>Prompt:</label>
                    <textarea id="prompt-config">${self.config.prompt}</textarea>
                </div>
                <div class="config-field">
                    <label>Chat URL:</label>
                    <input type="text" id="chat-url-config" value="${self.config.chat_url}">
                </div>
                <div class="config-field">
                    <label>Models URL:</label>
                    <input type="text" id="models-url-config" value="${self.config.models_url}">
                </div>
                <div class="config-field">
                    <label>Api Token:</label>
                    <input type="password" id="api-token" value="${self.config.apiToken}">
                </div>                
                <div class="config-field">
                    <label>Model:</label>
                    <div class="model-selection">
                        <select id="model-config"></select>
                        <button type="button" class="refresh-models" title="Refresh models">🔄</button>
                    </div>
                    <div id="model-info" style="margin-top: 8px; font-size: 0.9em;"></div>
                </div>                
                <div class="config-buttons">
                    <button type="button" class="config-save">Save</button>
                    <button type="button" class="config-cancel">Cancel</button>
                </div>
            `;
                configPanel.appendChild(configForm);
                configForm.querySelectorAll('input').forEach(input => {
                    ignoreKeyStrokesWhenInputHasFocus(shadowRoot, input)
                })

                const modelSelect = configForm.querySelector('#model-config');
                modelSelect.addEventListener('change', (e) => {
                    // const selectedOption = e.target.selectedOptions[0];
                    // const modelInfo = selectedOption.dataset;
                    // const modelInfoDiv = configForm.querySelector('#model-info');
                    // if (modelInfo.contextWindow || modelInfo.ownedBy) {
                    //     modelInfoDiv.innerHTML = `
                    //         ${modelInfo.contextWindow ? `<div>Context Window: ${modelInfo.contextWindow}</div>` : ''}
                    //         ${modelInfo.ownedBy ? `<div>Provider: ${modelInfo.ownedBy}</div>` : ''}
                    //     `;
                    // } else {
                    //     modelInfoDiv.innerHTML = '';
                    // }
                });

                const saveBtn = configPanel.querySelector('.config-save');
                saveBtn.addEventListener('click', () => {
                    const config = {
                        prompt: configForm.querySelector('#prompt-config').value,
                        chat_url: configForm.querySelector('#chat-url-config').value,
                        models_url: configForm.querySelector('#models-url-config').value,
                        apiToken: configForm.querySelector('#api-token').value,
                        llm: configForm.querySelector('#model-config').value
                    };
                    self.saveConfig(config)
                });
                
                const cancelBtn = configPanel.querySelector('.config-cancel');
                cancelBtn.addEventListener('click', () => self.hideConfigPanel());
    
                const refreshBtn = configPanel.querySelector('.refresh-models');
                refreshBtn.addEventListener('click', () => {
                    const config = {
                        prompt: configForm.querySelector('#prompt-config').value,
                        chat_url: configForm.querySelector('#chat-url-config').value,
                        models_url: configForm.querySelector('#models-url-config').value,
                        apiToken: configForm.querySelector('#api-token').value,
                        llm: configForm.querySelector('#model-config').value
                    };
                    self.refreshModels(config);
                });

                return configPanel
            }
        }

        async refreshModels(configParam) {
            if (!configParam)
                configParam = this.config
            const modelSelect = this.configPanel.querySelector('#model-config');
            modelSelect.innerHTML = '<option>Loading...</option>';
            try {
                const headers = {};
                if (configParam.apiToken) {
                    headers['Authorization'] = `Bearer ${configParam.apiToken}`;
                }
                const response = await fetch(configParam.models_url, {
                    headers
                });
                const jsonResponse = await response.json();
                let models = jsonResponse.data || []
                modelSelect.innerHTML = '';
                models.forEach(m => {
                    const option = document.createElement('option');
                    const modelName = m.id
                    option.value = modelName;
                    option.textContent = modelName;
                    if (modelName === this.config.llm) {
                        option.selected = true;
                    }
                    modelSelect.appendChild(option);
                });
            } catch (error) {
                console.error('Error fetching models:', error);
                modelSelect.innerHTML = '<option>Error loading models</option>';
            }
        }

        showConfigPanel() {
            this.chatContent.style.display = 'none';
            this.userInputArea.style.display = 'none';
            this.configPanel.style.display = 'block';
            this.refreshModels();
        }

        hideConfigPanel() {
            this.configPanel.style.display = 'none';
            this.chatContent.style.display = 'block';
            this.userInputArea.style.display = 'flex';
        }

        async saveConfig(configParam) {
            const newConfig = {
                ...this.config,
                ...configParam
            };

            this.config = newConfig;
            await GM.setValue("config", newConfig);
            this.hideConfigPanel();
            this.addAssistantMessage("Configuration saved successfully!");
        }

        showPanel(selection) {
            this.chatOverlay.classList.add('visible');
            this.chatOpenButton.hide();
            let selectedText = selection?.toString();
            console.log("Selected text: " + selectedText);
            
            if (!selectedText) {
                this.userInput.focus();
                return null;
            }
            
            this.messageHistory.userMessage(`
                I have the following selected text and I may ask questions or discuss it.
                ----
                ${selectedText}
                ----
                `);
            
            this.addAssistantMessage(`You have selected text. Feel free to ask questions or discuss it.`);
            this.userInput.focus();
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
            contentMessage.innerHTML = marked.parse(content || '');
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
                contentMessage.innerHTML = marked.parse(content || '');
            this.chatContent.appendChild(contentMessage);
            this.scrollToBottom();
        }

        async sendMessage() {
            const userMessage = this.userInput.value.trim();
            if (!userMessage) return;


            this.addUserMessage(userMessage);
            this.userInput.value = '';

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
            this.userInput.disabled = true;
            this.sendBtn.disabled = true;
            const typingIndicator = createTypingIndicator();
            this.chatContent.appendChild(typingIndicator);

            try {
                messageHistory.userMessage(query)
                const response = await sendQuery(this.config, messageHistory);

                console.log("response: " + JSON.stringify(response, null, 2))
                let content = await handleToolCalls(response.choices[0].message)
                this.addAssistantMessage(content);

            } catch (error) {
                console.error('Error:', error);
                this.addAssistantMessage("An error occurred: " + error.message);
            } finally {
                if (this.chatContent.contains(typingIndicator)) {
                    this.chatContent.removeChild(typingIndicator);
                }
                this.scrollToBottom();
                this.userInput.disabled = false;
                this.sendBtn.disabled = false;
                this.userInput.focus();
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
                    initConfig(this)
                    return null
                case '/reset_history':
                    this.messageHistory.init()
                    return null
                
                default:
                    return userInput;
            }
        }
    }    


    async function initConfig(chatModal) {
        chatModal.showPanel()
        chatModal.showConfigPanel()
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
        messageHistory.userMessage("This is the current page content: \n" + getPageContent())
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
            //"tools": availableTools
        }
        let headers = {}
        if (config.apiToken) {
            headers['Authorization'] = `Bearer ${config.apiToken}`;
        }
        const response = await fetch(`${config.chat_url}`,
            {
                method: 'POST',
                headers: {
                    ...headers,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(req)
            });
        if (response.ok) 
            return await response.json();
        
        if (response.status === 401) 
            throw new Error('Unauthorized, invalid API token')
        
        if (response.status === 403) 
            throw new Error('Forbidden, check your API token')
        
        if (response.status >= 400 && response.status < 500) {
            let errorMessage = await response.json()
            throw new Error(errorMessage.error.message)
        }
        throw new Error('Failed to communicate with LLM!! \n' + response.statusText)
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
                color: #000;
            }

            .chat-header {
                display: flex;
                justify-content: flex-end;
                padding: 10px;
                border-bottom: 1px solid #e0e0e0;
            }

            .config-button {
                background: none;
                border: 1px solid #666;
                font-size: 12px;
                cursor: pointer;
                color: #666;
                border-radius: 8px;
                margin-right: 10px;
            }

            .config-button:hover {
                color: #000;
                background: aliceblue;
            }

            .config-panel {
                padding: 20px;
                display: none;
            }

            .config-field {
                margin-bottom: 15px;
            }

            .config-field label {
                display: block;
                margin-bottom: 5px;
                font-weight: bold;
            }

            .config-field input,
            .config-field textarea,
            .config-field select {
                width: calc(100% - 20px);
                padding: 8px;
                border: 1px solid #ddd;
                border-radius: 4px;
            }

            .model-selection {
                display: flex;
                gap: 10px;
                align-items: center;
            }

            .model-selection select {
                flex-grow: 1;
            }

            .refresh-models {
                padding: 8px;
                background: none;
                border: 1px solid #ddd;
                border-radius: 4px;
                cursor: pointer;
            }

            .refresh-models:hover {
                background-color: #f0f0f0;
            }

            .config-field textarea {
                height: 100px;
                resize: vertical;
            }

            .config-buttons {
                display: flex;
                justify-content: flex-end;
                gap: 10px;
            }

            .config-buttons button {
                padding: 8px 16px;
                border: none;
                border-radius: 4px;
                cursor: pointer;
            }

            .config-save {
                background-color: #007bff;
                color: white;
            }

            .config-cancel {
                background-color: #6c757d;
                color: white;
            }

            .chat-content {
                flex-grow: 1;
                overflow-y: auto;
                padding: 15px;
                border-bottom: 1px solid #e0e0e0;
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
                background-color: #fff;
                color: #000;
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
                background: none;
                border: 1px solid #666;
                font-size: 12px;
                cursor: pointer;
                color: #666;
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


    let toolFunctions = {
        "get_assistant_configuration": function() {
            return "The current configuration is: " + JSON.stringify(CHAT_MODAL.config, null, 2)
        }
    }

    async function handleToolCalls(message) {
        if (message.tool_calls) {
            return JSON.stringify(message.tool_calls)
        }
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
        return message.content
    }


    main()
})();
