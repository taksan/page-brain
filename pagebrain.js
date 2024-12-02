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
        "models_url": "http://localhost:11434/v1/models",
        "research_mode": false,
        "research_goal": null
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
        let assistantButton = new AssistantButton(theShadowRoot)
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
            this.researchGoal = this.config.research_goal || null;
            this.currentPageAnalyzed = false;
            this.researchNotes = [];
            this.pendingInsights = null;
            this.researchButton = new ResearchButton(shadowRoot, this);
            this.loadResearchNotes();
            
            if (this.researchGoal) {
                this.researchButton.show();
            } else {
                this.addAssistantMessage("Type '/overview' to get an overview of the page content or /help to see the commands");
            }
        }

        async loadResearchNotes() {
            this.researchNotes = await GM.getValue("research_notes", []);
        }

        async saveResearchNotes() {
            await GM.setValue("research_notes", this.researchNotes);
        }

        async addResearchNote(content) {
            const currentUrl = window.location.href;
            const prompt = `You must respond ONLY with a JSON object in the following format, with NO additional text before or after:
{
    "summary": "a very brief summary of the page (max 50 words)",
    "isRelevant": true or false (boolean value, no quotes)
}

Analyze the following insights about a webpage in relation to the research goal: "${this.researchGoal}"

Insights to analyze:
${content}`;

            try {
                this.messageHistory.userMessage(prompt);
                const response = await sendQuery(this.config, this.messageHistory);
                const aiMessage = response.choices[0].message.content.trim();
                
                // Try to extract JSON if it's wrapped in other text
                let jsonStr = aiMessage;
                const jsonMatch = aiMessage.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    jsonStr = jsonMatch[0];
                }
                
                let analysis;
                try {
                    analysis = JSON.parse(jsonStr);
                    
                    // Validate the required fields
                    if (typeof analysis.summary !== 'string' || typeof analysis.isRelevant !== 'boolean') {
                        throw new Error('Invalid JSON structure');
                    }
                } catch (jsonError) {
                    console.error('Invalid JSON response:', aiMessage);
                    throw new Error('Failed to parse AI response as JSON');
                }

                const note = {
                    url: currentUrl,
                    summary: analysis.summary,
                    insights: content,
                    isRelevant: analysis.isRelevant,
                    timestamp: new Date().toISOString()
                };

                this.researchNotes.push(note);
                await this.saveResearchNotes();

                // Add a message about the page's relevance
                const relevanceMsg = analysis.isRelevant 
                    ? "✅ This page has been added to your research notes."
                    : "❌ This page was analyzed but deemed not relevant to your research goal.";
                this.addNoAiMessage(relevanceMsg);
            } catch (error) {
                console.error('Error processing research note:', error);
                console.error('AI response:', error.aiResponse);
                this.addNoAiMessage(
                    "⚠️ Error processing research note. The page was analyzed but couldn't be added to research notes." +
                    "Check the console for more insights.");
                // Reset the currentPageAnalyzed flag so user can try again
                this.currentPageAnalyzed = false;
            }
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

            let {userInput, sendBtn, userInputArea} = createSendUserInput(this)
            this.modal.appendChild(userInputArea);
            this.userInput = userInput
            this.sendBtn = sendBtn
            this.userInputArea = userInputArea
            this.researchModeAlertPrinted = false


            function createChatMessageArea() {
                let chatContent = document.createElement('div');
                chatContent.className = 'chat-content';
                return chatContent
            }

            function createSendUserInput(self) {
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

                // Create tab buttons
                const tabButtons = document.createElement('div');
                tabButtons.className = 'config-tabs';
                const settingsTab = document.createElement('button');
                settingsTab.textContent = 'LLM Settings';
                settingsTab.className = 'tab-button active';
                const researchTab = document.createElement('button');
                researchTab.textContent = 'Research';
                researchTab.className = 'tab-button';
                tabButtons.appendChild(settingsTab);
                tabButtons.appendChild(researchTab);
                configPanel.appendChild(tabButtons);

                // Create settings form
                const configForm = document.createElement('form');
                configForm.className = 'tab-content settings-tab active';
                configForm.innerHTML = `
                    <div class="config-field">
                        <label>System Prompt:</label>
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

                // Create research form
                const researchForm = document.createElement('form');
                researchForm.className = 'tab-content research-tab';
                researchForm.innerHTML = `
                    <div class="config-field">
                        <label>Research Goal:</label>
                        <textarea id="research-goal">${self.config.research_goal || ''}</textarea>
                    </div>
                    <div class="config-buttons">
                        <button type="button" class="research-save">Save</button>
                        <button type="button" class="research-cancel">Cancel</button>
                    </div>
                `;

                configPanel.appendChild(configForm);
                configPanel.appendChild(researchForm);

                // Tab switching logic
                settingsTab.addEventListener('click', () => {
                    settingsTab.classList.add('active');
                    researchTab.classList.remove('active');
                    configForm.classList.add('active');
                    researchForm.classList.remove('active');
                });

                researchTab.addEventListener('click', () => {
                    researchTab.classList.add('active');
                    settingsTab.classList.remove('active');
                    researchForm.classList.add('active');
                    configForm.classList.remove('active');
                });

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

                const saveBtn = configForm.querySelector('.config-save');
                saveBtn.addEventListener('click', () => {
                    const config = {
                        prompt: configForm.querySelector('#prompt-config').value,
                        chat_url: configForm.querySelector('#chat-url-config').value,
                        models_url: configForm.querySelector('#models-url-config').value,
                        apiToken: configForm.querySelector('#api-token').value,
                        llm: configForm.querySelector('#model-config').value
                    };
                    self.saveConfig(config);
                });
                
                const cancelBtn = configForm.querySelector('.config-cancel');
                cancelBtn.addEventListener('click', () => self.hideConfigPanel());
                
                const refreshBtn = configForm.querySelector('.refresh-models');
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

                const researchSaveBtn = researchForm.querySelector('.research-save');
                researchSaveBtn.addEventListener('click', () => {
                    self.researchGoal = researchForm.querySelector('#research-goal').value;
                    self.saveResearchState();
                    if (self.researchGoal) {
                        self.researchButton.show();
                    } else {
                        self.researchButton.hide();
                    }
                    self.hideConfigPanel();
                });

                const researchCancelBtn = researchForm.querySelector('.research-cancel');
                researchCancelBtn.addEventListener('click', () => self.hideConfigPanel());

                return configPanel;
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

        async saveResearchState() {
            const updatedConfig = {
                ...this.config,
                research_goal: this.researchGoal
            };
            this.config = updatedConfig;
            await GM.setValue("config", updatedConfig);
        }

        showPanel(selection) {
            this.chatOverlay.classList.add('visible');
            this.chatOpenButton.hide();
            this.researchButton.hide();
            
            // If we have pending insights from research button, process them
            if (this.pendingInsights) {
                this.messageHistory.userMessage(`Based on my research goal: "${this.researchGoal}", what insights can I gain from this page?`);
                this.addAssistantMessage("These are the insights I have gathered about this page based on my research goal: " + this.researchGoal);
                this.addAssistantMessage(this.pendingInsights);
                this.addResearchNote(this.pendingInsights);
                this.pendingInsights = null;
                this.currentPageAnalyzed = true;
                return;
            }
            
            let selectedText = selection?.toString();
            console.log("Selected text: " + selectedText);
            
            if (!selectedText) {
                if (this.researchGoal && !this.currentPageAnalyzed && !this.researchModeAlertPrinted) {
                    this.addNoAiMessage(`Research mode is active. Current goal: "${this.researchGoal}"\nTo analyze this page:\n1. Click the research button 🔍, or\n2. Type "/research-now"`);
                    this.researchModeAlertPrinted = true;
                }
                this.userInput.focus();
                return null;
            }
            
            if (!this.researchGoal || this.currentPageAnalyzed) {
                this.messageHistory.userMessage(`
                    I have the following selected text and I may ask questions or discuss it.
                    ----
                    ${selectedText}
                    ----
                    `);
                
                this.addAssistantMessage(`You have selected text. Feel free to ask questions or discuss it.`);
            }
            this.userInput.focus();
        }

        closePanel() {
            this.chatOverlay.classList.remove('visible');
            this.chatOpenButton.show();
            if (this.researchGoal) {
                this.researchButton.show();
            }
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

        addNoAiMessage(content) {
            const contentMessage = document.createElement('div');
            contentMessage.className = 'chat-message assistant';
            if (content instanceof HTMLElement)
                contentMessage.appendChild(content);
            else
                contentMessage.innerHTML = marked.parse(content || '');
            this.chatContent.appendChild(contentMessage);
            this.scrollToBottom();
        }

        async analyzePageForResearch() {
            if (!this.researchGoal) {
                this.addNoAiMessage("Research mode is not active. Use /research <goal> to start research mode first.");
                return null;
            }

            const content = getPageContent();
            this.messageHistory.userMessage(`Based on my research goal: "${this.researchGoal}", what insights can I gain from this page?`);
            this.addAssistantMessage("Analyzing the page content based on your research goal...");
            
            try {
                const response = await sendQuery(this.config, this.messageHistory);
                return response.choices[0].message;
            } catch (error) {
                console.error('Error analyzing page:', error);
                this.addNoAiMessage("⚠️ Error analyzing the page. Please try again.");
                return null;
            }
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

        async sendChatMessage(query, isResearchAnalysis = false) {
            this.userInput.disabled = true;
            this.sendBtn.disabled = true;
            const typingIndicator = createTypingIndicator();
            this.chatContent.appendChild(typingIndicator);

            try {
                messageHistory.userMessage(query)
                const response = await sendQuery(this.config, messageHistory);

                let content = await handleToolCalls(response.choices[0].message)
                this.addAssistantMessage(content);

                // If this is a research analysis, process it for research notes
                if (isResearchAnalysis && this.researchGoal) {
                    await this.addResearchNote(content);
                }

            } catch (error) {
                console.error('Error:', error);
                this.addNoAiMessage("An error occurred: " + error.message);
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

        defaultPreProcessPrompt(userInput) {
            const input = userInput.toLowerCase().trim();
            const commands = [
                { 
                    command: '/help',
                    description: 'Show help',
                    action: () => {
                        const commandList = commands
                            .map(c => `- ${c.command}${c.usage || ''}: ${c.description}`)
                            .join('\n');
                        this.addNoAiMessage("Available commands:\n" + commandList);
                        return null;
                    },
                    acceptInput: (input) => input === '/help'
                },
                { 
                    command: '/research-now',
                    description: 'Analyze current page for research',
                    action: async () => {
                        if (!this.researchGoal) {
                            this.addNoAiMessage("Research mode is not active. Use /research <goal> to start research mode first.");
                            return null;
                        }
                        return this.analyzePageForResearch();
                    },
                    acceptInput: (input) => input === '/research-now'
                },
                { 
                    command: '/overview',
                    description: 'Get an overview of the page content',
                    action: () => summarizePrompt(),
                    acceptInput: (input) => input === '/overview'
                },
                {
                    command: '/reset',
                    description: 'Reset all settings and research data',
                    action: () => {
                        GM.deleteValue("config");
                        GM.deleteValue("research_notes");
                        this.config = defaultConfig;
                        this.researchGoal = null;
                        this.currentPageAnalyzed = false;
                        this.researchNotes = [];
                        initConfig(this);
                        this.addNoAiMessage("All settings and research data have been reset.");
                        return null;
                    },
                    acceptInput: (input) => input === '/reset'
                },
                {
                    command: '/reset_history',
                    description: 'Reset the chat history',
                    action: () => {
                        this.messageHistory.init();
                        this.addNoAiMessage("Chat history has been reset.");
                        return null;
                    },
                    acceptInput: (input) => input === '/reset_history'
                },
                {
                    command: '/research',
                    description: 'Start research mode with a goal',
                    usage: ' <goal>',
                    action: () => {
                        const goal = userInput.slice(10).trim();
                        if (!goal) {
                            this.addNoAiMessage("Please specify a research goal. Usage: /research <your research goal>");
                            return null;
                        }
                        this.researchGoal = goal;
                        this.currentPageAnalyzed = false;
                        this.researchNotes = [];
                        this.saveResearchNotes();
                        this.saveResearchState();
                        this.researchButton.show();
                        this.addNoAiMessage(`Research mode activated. Goal: "${goal}"\nI will analyze each page you visit based on this research goal.`);
                        return null;                        
                    },
                    acceptInput: (input) => input.startsWith('/research ')
                },
                {
                    command: '/stop_research',
                    description: 'Stop research mode',
                    action: () => {
                        if (!this.researchGoal) {
                            this.addNoAiMessage("Research mode is not active.");
                            return null;
                        }
                        this.researchGoal = null;
                        this.currentPageAnalyzed = false;
                        this.researchNotes = [];
                        this.saveResearchNotes();
                        this.saveResearchState();
                        this.researchButton.hide();
                        this.addNoAiMessage("Research mode deactivated.");
                        return null;
                    },
                    acceptInput: (input) => input === '/stop_research'
                },
                {
                    command: '/reanalyze',
                    description: 'Re-analyze the current page',
                    action: async () => {
                        if (!this.researchGoal) {
                            this.addNoAiMessage("Research mode is not active.");
                            return null;
                        }
                        return this.analyzePageForResearch();
                    },
                    acceptInput: (input) => input === '/reanalyze'
                },
                {
                    command: '/notes',
                    description: 'Show collected research notes',
                    action: () => {
                        if (!this.researchGoal) {
                            this.addNoAiMessage("Research mode is not active.");
                            return null;
                        }
                        if (this.researchNotes.length === 0) {
                            this.addNoAiMessage("No research notes collected yet.");
                            return null;
                        }
                        const relevantNotes = this.researchNotes.filter(note => note.isRelevant);
                        const notRelevantCount = this.researchNotes.length - relevantNotes.length;
                        
                        let message = `# Research Notes\nGoal: "${this.researchGoal}"\n\n`;
                        message += `📊 Stats: ${relevantNotes.length} relevant pages found (${notRelevantCount} not relevant)\n\n`;
                        
                        if (relevantNotes.length > 0) {
                            message += "## Relevant Pages\n\n";
                            relevantNotes.forEach((note, index) => {
                                message += `### ${index + 1}. ${note.summary}\n`;
                                message += `🔗 ${note.url}\n\n`;
                                message += `📝 Insights:\n${note.insights}\n\n---\n\n`;
                            });
                        }
                        
                        this.addNoAiMessage(message);
                        return null;                        
                    },
                    acceptInput: (input) => input === '/notes'
                }
            ];

            if (!input.startsWith('/')) return input;

            for (const command of commands) {
                if (command.acceptInput(input)) {
                    return command.action();
                }
            }
            
            this.addNoAiMessage("Unknown command. Type /help for a list of available commands.");
            return null;
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

    class AssistantButton {
        constructor(shadowRoot) {
            this.shadowRoot = shadowRoot;
            this.button = document.createElement('button');
            this.button.id = 'assistant-btn';
            this.button.innerText = '✨';
            this.button.title = 'Talk about page content';

            // Drag functionality variables
            this.dragStarted = false;
            this.currentX = 0;
            this.currentY = 0;
            this.initialX = 0;
            this.initialY = 0;
            this.xOffset = 0;
            this.yOffset = 0;
            this.currentSelection = null;

            // Bind methods to maintain correct 'this' context
            this.dragStart = this.dragStart.bind(this);
            this.drag = this.drag.bind(this);
            this.dragEnd = this.dragEnd.bind(this);
            this.handleEscape = this.handleEscape.bind(this);

            // Add event listeners
            this.button.addEventListener('mousedown', this.dragStart);
            document.addEventListener('mousemove', this.drag);
            document.addEventListener('mouseup', this.dragEnd);
            document.addEventListener('keydown', this.handleEscape);

            this.shadowRoot.appendChild(this.button);
        }

        handleEscape(e) {
            if (e.key === 'Escape') {
                CHAT_MODAL?.closePanel();
            }
        }

        dragStart(e) {
            if (window.getSelection().rangeCount > 0) {
                this.currentSelection = window.getSelection().getRangeAt(0).cloneRange();
            }

            this.initialX = e.clientX - this.xOffset;
            this.initialY = e.clientY - this.yOffset;
            this.currentX = this.initialX;
            this.currentY = this.initialY;

            if (e.target === this.button) {
                this.dragStarted = true;
            }
        }

        drag(e) {
            if (this.dragStarted) {
                e.preventDefault();
                this.currentX = e.clientX - this.initialX;
                this.currentY = e.clientY - this.initialY;

                this.xOffset = this.currentX;
                this.yOffset = this.currentY;

                this.setTranslate(this.currentX, this.currentY, this.button);
            }
        }

        setTranslate(xPos, yPos, el) {
            el.style.transform = `translate3d(${xPos}px, ${yPos}px, 0)`;
        }

        dragEnd() {
            if (this.dragStarted) {
                this.dragStarted = false;
                if (Math.abs(this.currentX - this.initialX) < 5 && Math.abs(this.currentY - this.initialY) < 5) {
                    openChat(this.currentSelection);
                    return;
                }

                this.initialX = this.currentX;
                this.initialY = this.currentY;
            }
        }

        hide() {
            this.button.classList.add('hidden');
        }

        show() {
            this.button.classList.remove('hidden');
        }
    }

    class ResearchButton {
        constructor(shadowRoot, chatModal) {
            this.shadowRoot = shadowRoot;
            this.chatModal = chatModal;
            this.button = document.createElement('button');
            this.button.id = 'research-btn';
            this.button.innerText = '🔍';
            this.button.title = 'Analyze page for research';
            this.button.style.display = 'none';
            
            this.analyzing = false;
            this.analyzed = false;
            
            this.button.addEventListener('click', () => this.handleClick());
            this.shadowRoot.appendChild(this.button);
        }
        
        async handleClick() {
            if (this.analyzing) return;
            
            if (this.analyzed) {
                // If already analyzed, show the panel with insights
                this.chatModal.showPanel();
                return;
            }
            
            // Start analysis
            this.analyzing = true;
            this.button.innerText = '⌛';
            this.button.title = 'Analyzing page...';
            
            try {
                const insights = await this.chatModal.analyzePageForResearch();
                if (insights) {
                    // Store insights for when panel is opened
                    this.chatModal.pendingInsights = insights.content;

                    // Update button state
                    this.analyzed = true;
                    this.button.innerText = '✅';
                    this.button.title = 'View research insights';
                } else {
                    // Error occurred during analysis
                    this.button.innerText = '❌';
                    this.button.title = 'Error analyzing page. Click to retry.';
                    this.analyzed = false;
                }
            } catch (error) {
                console.error('Error in research button:', error);
                this.button.innerText = '❌';
                this.button.title = 'Error analyzing page. Click to retry.';
                this.analyzed = false;
            }
            
            this.analyzing = false;
        }
        
        show() {
            this.button.style.display = 'block';
            // Reset state when showing
            this.analyzing = false;
            this.analyzed = false;
            this.button.innerText = '🔍';
            this.button.title = 'Analyze page for research';
        }
        
        hide() {
            this.button.style.display = 'none';
        }
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

            .modal-overlay {
                display: none;
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(0, 0, 0, 0.5);
                justify-content: center;
                align-items: center;
                z-index: 10000;
            }

            #assistant-btn, #research-btn {
                position: fixed;
                right: 20px;
                width: 40px;
                height: 40px;
                border-radius: 50%;
                background: white;
                border: 2px solid #ddd;
                cursor: pointer;
                font-size: 20px;
                box-shadow: 0 2px 5px rgba(0,0,0,0.2);
                transition: all 0.3s ease;
                z-index: 10000;
                opacity: 0.3;
            }

            #assistant-btn {
                bottom: 50vh;  /* Center vertically */
            }

            #research-btn {
                bottom: calc(50vh + 50px);  /* 50px above the assistant button */
                background: #f0f8ff;  /* Light blue background */
            }

            #assistant-btn:hover, #research-btn:hover {
                transform: scale(1.1);
                box-shadow: 0 3px 7px rgba(0,0,0,0.3);
                opacity: 1;
            }

            #assistant-btn.hidden, #research-btn.hidden {
                display: none !important;
            }

            #research-btn[title*="Error"] {
                background: #fff0f0;  /* Light red background for error state */
                border-color: #ffcccc;
                opacity: 1;
            }

            #research-btn[title*="Analyzing"] {
                background: #f0fff0;  /* Light green background while analyzing */
                border-color: #ccffcc;
                opacity: 1;
            }
            #research-btn[title*="View"] {
                opacity: 1;
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
                height: 85vh;
                display: flex;
                flex-direction: column;
                color: #000;
            }

            .chat-header {
                display: flex;
                justify-content: flex-end;
                padding: 10px;
                border-bottom: 1px solid #e0e0e0;
                flex-shrink: 0;
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
                height: 100%;
                display: flex;
                flex-direction: column;
            }

            .config-tabs {
                display: flex;
                gap: 10px;
                margin-bottom: 20px;
                background: white;
                z-index: 1;
                padding-bottom: 10px;
                flex-shrink: 0;
            }

            .tab-button {
                padding: 8px 16px;
                border: none;
                background: none;
                border-bottom: 2px solid transparent;
                cursor: pointer;
                font-size: 14px;
                color: #666;
            }

            .tab-button:hover {
                color: #007bff;
            }

            .tab-button.active {
                color: #007bff;
                border-bottom-color: #007bff;
            }

            .tab-content {
                display: none;
                overflow-y: auto;
                flex: 1;
                margin-bottom: 70px;
            }

            .tab-content.active {
                display: block;
            }

            .config-field {
                margin-bottom: 15px;
            }

            .config-field label {
                display: block;
                margin-bottom: 5px;
                color: #666;
                font-size: 13px;
            }

            .checkbox-field label {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 8px;
                cursor: pointer;
                color: #333;
                font-size: 14px;
                font-weight: normal;
            }

            .config-field input,
            .config-field textarea,
            .config-field select {
                width: calc(100% - 20px);
                padding: 8px;
                border: 1px solid #ddd;
                border-radius: 4px;
                font-size: 14px;
            }

            .config-field textarea {
                height: 100px;
                resize: vertical;
                line-height: 1.4;
            }

            .config-field input:focus,
            .config-field textarea:focus,
            .config-field select:focus {
                outline: none;
                border-color: #007bff;
                box-shadow: 0 0 0 2px rgba(0,123,255,.25);
            }

            .checkbox-field input[type="checkbox"] {
                width: auto;
                margin: 0;
                cursor: pointer;
            }

            h3 {
                font-size: 16px;
                color: #333;
                margin-bottom: 20px;
                font-weight: 500;
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

            .config-buttons {
                display: flex;
                justify-content: flex-end;
                gap: 10px;
                position: fixed;
                bottom: 7.5vh;
                right: 20px;
                background: white;
                padding: 15px 20px;
                width: calc(80% - 40px);
                max-width: 560px;
            }

            .config-buttons button,
            .research-save,
            .research-cancel {
                padding: 8px 16px;
                border: none;
                border-radius: 4px;
                cursor: pointer;
                font-size: 14px;
            }

            .config-save,
            .research-save {
                background-color: #007bff;
                color: white;
            }

            .config-save:hover,
            .research-save:hover {
                background-color: #0056b3;
            }

            .config-cancel,
            .research-cancel {
                background-color: #6c757d;
                color: white;
            }

            .config-cancel:hover,
            .research-cancel:hover {
                background-color: #545b62;
            }

            .chat-content {
                flex-grow: 1;
                overflow-y: auto;
                padding: 15px;
                border-bottom: 1px solid #e0e0e0;
                max-height: calc(85vh - 150px);
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
            .config-field label {
                display: block;
                margin-bottom: 5px;
                font-weight: bold;
            }

            .checkbox-field label {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 8px;
                cursor: pointer;
            }

            .checkbox-field input[type="checkbox"] {
                width: auto;
                margin: 0;
                cursor: pointer;
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

    async function saveToDontpad(documentName, text) {
        const tsResponse = await fetch(`https://api.dontpad.com/${documentName}.body.json?lastModified=0`);
        if (tsResponse.status === 200) {
            const lm = JSON.parse(tsResponse.responseText).lastModified;

            // Then, post the text
            const postResponse = await fetch(`https://api.dontpad.com/${documentName}`, {
                method: 'POST',
                data: new URLSearchParams({
                    lastModified: lm,
                    force: 'false',
                    text: text
                }).toString(),
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                onload: function(postResponse) {
                    if (postResponse.status === 200) {
                        console.log('Success');
                        console.log(postResponse.responseText);
                    } else {
                        console.error('Post failed', postResponse);
                    }
                },
                onerror: function(error) {
                    console.error('Error posting:', error);
                }
            });
        } else {
            console.error('Failed to get last modified', tsResponse);
        }
    }    


    main()
})();
