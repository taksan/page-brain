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
// @require      https://unpkg.com/turndown/dist/turndown.js
// ==/UserScript==
(async function () {
  "use strict";

  let CHAT_MODAL = null;
  let messageHistory = null;

  async function main() {
    const storedConfig = await GM.getValue("config", null);
    const configModel = new ConfigModel(storedConfig);
    messageHistory = new ChatHistory(configModel);

    let theShadowRoot = createShadowRoot();
    addStyling(theShadowRoot);
    addTypingStyle(theShadowRoot);
    let assistantButton = new AssistantButton(theShadowRoot);
    let researchNotes = await GM.getValue("research_notes", []);
    CHAT_MODAL = new ChatModal(
      theShadowRoot,
      assistantButton,
      messageHistory,
      configModel,
      new ResearchNotesModel(researchNotes)
    );
    if (!configModel.get('llm')) {
      initConfig(CHAT_MODAL);
      return;
    }
    messageHistory.init();
  }

  class ChatModal {
    constructor(shadowRoot, chatOpenButton, messageHistory, configModel, researchNotesModel) {
      this.messageHistory = messageHistory;
      this.configModel = configModel;
      this.chatOpenButton = chatOpenButton;
      this.createElements(shadowRoot);
      this.currentPageAnalyzed = false;
      this.researchNotes = researchNotesModel;
      this.researchAgent = new ResearchAgent(configModel,this.researchNotes)
      this.pendingInsights = null;
      this.researchButton = new ResearchButton(shadowRoot, this);
      this.overviewAgent = new OverviewAgent(configModel);
      
      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
          this.closePanel();
        }
      });

      // Listen for config changes
      this.configModel.addListener((config) => {
        if (config.research_goal) {
          this.researchButton.show();
        } else {
          this.researchButton.hide();
        }
      });

      if (this.configModel.get('research_goal')) {
        this.researchButton.show();
      } else {
        this.addAssistantMessage(
          "Type '/overview' to get an overview of the page content or /help to see the commands",
        );
      }
    }

    async doResearch(content) {
      if (this.researchAgent.isAnalysisRequired())
        return

      let response = await this.researchAgent.analyzePageForResearch(content, this.messageHistory);
      this.addNoAiMessage(response)
    }

    createElements(shadowRoot) {
      _node(shadowRoot).children(
        _node(this.chatOverlay = _div("modal-overlay"))
          .children(
            _node(this.modal = _div("chat-modal")).children(
              headerArea(this),
              configPanel(this),
              chatMessageArea(this),
              userInputArea(this),
              statusBar(this)
            )
          )
      )
      _$(shadowRoot).qa("input, textarea").forEach(input => {
        console.log(input);
        ignoreKeyStrokesWhenInputHasFocus(shadowRoot, input);
      });      

      this.researchModeAlertPrinted = false;

      function chatMessageArea(self) {
        return self.chatContent = _node('div')
          .attr({ className: "chat-content" })
          .build();
      }

      function userInputArea(self) {
        const sendInputMessage = async (inputComponent) => { 
          const userMessage = inputComponent.value.trim();
          if (!userMessage) return;

          self.addUserMessage(userMessage);
          inputComponent.value = "";
          await self.sendMessage(userMessage);
        }
        const userInput = _node('textarea')
          .attr({
            className: "chat-input",
            placeholder: "Ask a question about the page..."
          })
          .on("keypress", (e) => {
            if (e.key === "Enter" && !e.ctrlKey) {
              sendInputMessage(userInput);
              e.preventDefault();
            }
          })
          .build();

        const sendBtn = _node('button')
          .attr({
            className: "chat-send-btn",
            innerText: "Send"
          })
          .on("click", () => sendInputMessage(userInput))
          .build();

        self.userInputArea = _node('div')
          .attr({ className: "chat-input-area" })
          .children(userInput, sendBtn)
          .build();

        self.userInput = userInput;
        self.sendBtn = sendBtn;

        return self.userInputArea;
      }

      function headerArea(self) {
        return _node('div')
          .attr({ className: "chat-header" })
          .children(
            _node('button')
              .attr({
                className: "config-button",
                innerHTML: "⚙️",
                title: "Configure"
              })
              .on("click", () => self.showConfigPanel()), 
            
            _node('button')
            .attr({
              className: "close-button",
              innerHTML: "×"
            })
            .on("click", () => self.closePanel())              
          )
      }

      function configPanel(self) {
        self.configSets = []
        const tabButtons = _node('div')
          .attr({ className: "config-tabs" })
          .build();
        
        self.configPanel = _node('div')
          .attr({ 
            className: "config-panel",
            style: "display: none" 
          })
          .children(
            tabButtons,
            configTab("LLM Settings", createLlmConfig(self.configModel)),
            configTab("Research", createResearchTab(self.configModel))
          )
          .build();

        return self.configPanel;

        function configTab(tabName, configForm) {
          const tabButton = _node('button')
            .attr({
              textContent: tabName,
              className: "tab-button",
              targetForm: configForm
            })
            .on("click", () => activateTab(tabButton, configForm))
            .build();

          tabButtons.appendChild(tabButton);
          return configForm;
        }

        function activateTab(tabButton, tabContent) {
          tabButtons
            .querySelectorAll(".tab-button")
            .forEach((button) => {
              button.classList.remove("active");
              button.targetForm.classList.remove("active");
            });

          tabButton.classList.add("active");
          tabContent.classList.add("active");
        }

        function createLlmConfig(configModel) {
          const form = _node('form')
            .attr({ className: "tab-content settings-tab active" })
            .html(`
              <div class="config-field">
                  <label>System Prompt:</label>
                  <textarea id="prompt-config"></textarea>
              </div>
              <div class="config-field">
                  <label>Chat URL:</label>
                  <input type="text" id="chat-url-config">
              </div>
              <div class="config-field">
                  <label>Models URL:</label>
                  <input type="text" id="models-url-config">
              </div>
              <div class="config-field">
                  <label>Api Token:</label>
                  <input type="password" id="api-token" autocomplete="off">
              </div>
              <div class="config-field">
                  <label>Model:</label>
                  <select id="model-config">
                      <option value="">Select a model</option>
                  </select>
                  <button type="button" class="refresh-models">🔄</button>
              </div>
              <div class="config-buttons">
                  <button type="button" class="config-save">Save</button>
                  <button type="button" class="config-cancel">Cancel</button>
              </div>
            `)
            .build(form => {
              const $form = _$(form);
              
              // Register handlers to update form when model changes
              const formUpdateHandler = (config) => {
                $form.q("#prompt-config").value = config.prompt || "";
                $form.q("#chat-url-config").value = config.chat_url || "";
                $form.q("#models-url-config").value = config.models_url || "";
                $form.q("#model-config").value = config.llm || "";
              };
              
              configModel.addListener(formUpdateHandler);

              // Initial form values
              const config = configModel.getAll();
              formUpdateHandler(config);

              $form.node(".config-save").on("click", async () => {
                configModel.removeListener(formUpdateHandler);
                try {
                  await configModel.update({
                    prompt: $form.value("#prompt-config"),
                    chat_url: $form.value("#chat-url-config"),
                    models_url: $form.value("#models-url-config"),
                    apiToken: $form.value("#api-token"),
                    llm: $form.value("#model-config"),
                  });
                } finally {
                  configModel.addListener(formUpdateHandler);
                }
                self.saveConfig();
              });

              $form.node(".config-cancel").on("click", () => 
                self.hideConfigPanel()
              );

              $form.q(".refresh-models").addEventListener("click", () => {
                const config = {
                  prompt: $form.value("#prompt-config"),
                  chat_url: $form.value("#chat-url-config"),
                  models_url: $form.value("#models-url-config"),
                  apiToken: $form.value("#api-token"),
                  llm: $form.value("#model-config"),
                };
                self.refreshModels(config);
              });
            });

          return form;
        }

        function createResearchTab(configModel) {
          const form = _node('form')
            .attr({ className: "tab-content research-tab" })
            .html(`
              <div class="config-field">
                  <label>Research Goal:</label>
                  <textarea id="research-goal"></textarea>
              </div>
              <div class="config-field">
                  <label>Stop Research</label>
                  <button type="button" class="stop-research">Stop</button>
              </div>
              <div class="config-buttons">
                  <button type="button" class="research-save">Save</button>
                  <button type="button" class="research-cancel">Cancel</button>
              </div>
            `)
            .build(form => {
              const $form = _$(form);

              // Register handler to update form when model changes
              const formUpdateHandler = (config) => {
                $form.q("#research-goal").value = config.research_goal || "";
              };
              
              configModel.addListener(formUpdateHandler);

              // Initial form value
              formUpdateHandler(configModel.getAll());

              $form.node(".research-save").on("click", async () => {
                configModel.removeListener(formUpdateHandler);
                try {
                  const researchGoal = $form.value("#research-goal");
                  await configModel.update({ research_goal: researchGoal });
                  self.hideConfigPanel();
                } finally {
                  configModel.addListener(formUpdateHandler);
                }
              });

              $form.node(".stop-research").on("click", async () => {
                configModel.removeListener(formUpdateHandler);
                try {
                  await configModel.update({ research_goal: null });
                  self.hideConfigPanel();
                } finally {
                  configModel.addListener(formUpdateHandler);
                }
              });

              $form.node(".research-cancel").on("click", () => 
                self.hideConfigPanel()
              );
            });

          return form;
        }
      }

      function statusBar(self) {
        return self.statusBar = _node('div')
          .attr({ 
            className: "status-bar",
            innerHTML: "Ready"
          })
          .build();
      }
    }

    showConfigPanel() {
      this.chatContent.style.display = "none";
      this.userInputArea.style.display = "none";
      this.configPanel.style.display = "block";
      this.refreshModels();
    }

    hideConfigPanel() {
      this.configPanel.style.display = "none";
      this.chatContent.style.display = "block";
      this.userInputArea.style.display = "flex";
    }

    async saveConfig() {
      this.hideConfigPanel();
      this.addAssistantMessage("Configuration saved successfully!");
      this.setStatus('Configuration saved', 'success');
    }


    showPanel(selection) {
      this.chatOverlay.classList.add("visible");
      this.chatOpenButton.hide();
      this.researchButton.hide();
      let researchGoal = this.configModel.get('research_goal');

      // If we have pending insights from research button, process them
      if (this.pendingInsights) {
        this.messageHistory.userMessage(
          `Based on my research goal: "${researchGoal}", what insights can I gain from this page?`,
        );
        this.addAssistantMessage(
          "These are the insights I have gathered about this page based on my research goal: " +
            researchGoal,
        );
        this.addAssistantMessage(this.pendingInsights);
        this.doResearch(this.pendingInsights);
        this.pendingInsights = null;
        this.userInput.focus();
        return;
      }
      if (this.researchAgent.isAnalysisRequired() && ! this.researchModeAlertPrinted) {
        this.addNoAiMessage(
          `Research mode is active. Current goal: "${researchGoal}"\nTo analyze this page:\n1. Click the research button 🔍, or\n2. Type "/research-now"`,
        );
        this.researchModeAlertPrinted = true;
      }

      let selectedText = selection?.toString();
      if (selectedText) {
        this.messageHistory.userMessage(`
                    I have selected the following text and I may ask questions or discuss it.
                    ----
                    ${selectedText}
                    ----
                    `);

        this.addNoAiMessage(
          `You have selected text. Feel free to ask questions or discuss it.`,
        );
      }
      this.userInput.focus();
    }

    closePanel() {
      this.chatOverlay.classList.remove("visible");
      this.chatOpenButton.show();
      if (this.configModel.get('research_goal')) {
        this.researchButton.show();
      }
    }

    scrollToBottom() {
      this.chatContent.scrollTop = this.chatContent.scrollHeight;
    }

    addAssistantMessage(content) {
      const contentMessage = _node('div')
        .attr({ className: "chat-message assistant" })
        .html(marked.parse(content || ""))
        .build();
      this.chatContent.appendChild(contentMessage);
      this.messageHistory.aiMessage(content);
      this.scrollToBottom();
    }

    addUserMessage(content) {
      const userMessageEl = _node('div')
        .attr({ className: "chat-message user" })
        .text(content)
        .build();
      this.chatContent.appendChild(userMessageEl);
      this.scrollToBottom();
    }

    addNoAiMessage(content) {
      const contentMessage = _node('div')
        .attr({ className: "chat-message assistant" });

      if (content instanceof HTMLElement) {
        contentMessage.children(content);
      } else {
        contentMessage.html(marked.parse(content || ""));
      }

      this.chatContent.appendChild(contentMessage.build());
      this.scrollToBottom();
    }

    async analyzePageForResearch() {
      if (!this.configModel.get('research_goal')) {
        this.addNoAiMessage(
          "Research mode is not active. Use /research <goal> to start research mode first.",
        );
        return null;
      }

      this.messageHistory.userMessage(
        `Based on my research goal: "${this.configModel.get('research_goal')}", what insights can I gain from this page?`,
      );
      this.addAssistantMessage(
        "Analyzing the page content based on your research goal...",
      );

      try {
        const response = await sendQueryToLLM(this.configModel, this.messageHistory);
        return response.choices[0].message;
      } catch (error) {
        console.error("Error analyzing page:", error);
        this.addNoAiMessage("⚠️ Error analyzing the page. Please try again.");
        return null;
      }
    }

    async sendMessage(userMessage) {
      let query = this.currentPreProcessPromptFunction(userMessage);
      if (!query) return;
      if (query instanceof Promise) {
        query = await query;
      }
      if (!query) return;
      
      this.userInput.disabled = true;
      this.sendBtn.disabled = true;

      const typingIndicator = createTypingIndicator();
      this.chatContent.appendChild(typingIndicator);

      try {
        this.messageHistory.userMessage(query);
        const response = await sendQueryToLLM(this.configModel, this.messageHistory);

        let content = await handleToolCalls(response.choices[0].message);
        this.addAssistantMessage(content);
      } catch (error) {
        console.error('Error sending message: ' + query, error);
        this.setStatus('Error sending message: ' + error.message, 'error');
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
      if (!configParam) configParam = this.configModel.getAll();
      const modelSelect = this.configPanel.querySelector("#model-config");
      modelSelect.innerHTML = "<option>Loading...</option>";
      try {
        const headers = {};
        if (configParam.apiToken) {
          headers["Authorization"] = `Bearer ${configParam.apiToken}`;
        }
        const response = await fetch(configParam.models_url, {
          headers,
        });
        const jsonResponse = await response.json();
        let models = jsonResponse.data || [];
        modelSelect.innerHTML = "";
        models.forEach((m) => {
          const option = _node('option')
            .attr({
              value: m.id,
              textContent: m.id,
            })
            .build();
          if (m.id === this.configModel.get('llm')) {
            option.selected = true;
          }
          modelSelect.appendChild(option);
        });
      } catch (error) {
        console.error("Error fetching models:", error);
        modelSelect.innerHTML = "<option>Error loading models</option>";
        this.setStatus('Error loading models: ' + error.message, 'error');
      }
    }

    async summarizePrompt() {
      const overview = await this.overviewAgent.process(getPageContent(), (message) => {
        this.setStatus(message);
      }, (error) => {
        console.error('Error during overview generation: ' + error.message);
        this.setStatus('Error during overview generation: ' + error.message, 'error');
      });
      
      this.addAssistantMessage(overview);
      return null
    }

    currentPreProcessPromptFunction(userInput) {
      const input = userInput.toLowerCase().trim();
      const commands = [
        {
          command: "/help",
          description: "Show help",
          action: () => {
            const commandList = commands
              .map((c) => `- ${c.command}${c.usage || ""}: ${c.description}`)
              .join("\n");
            this.addNoAiMessage("Available commands:\n" + commandList);
            return null;
          },
          acceptInput: (input) => input === "/help",
        },
        {
          command: "/research-now",
          description: "Analyze current page for research",
          action: async () => {
            if (!this.configModel.get('research_goal')) {
              this.addNoAiMessage(
                "Research mode is not active. Use /research <goal> to start research mode first.",
              );
              return null;
            }
            return this.analyzePageForResearch();
          },
          acceptInput: (input) => input === "/research-now",
        },
        {
          command: "/overview",
          description: "Get an overview of the page content",
          action: () => { return this.summarizePrompt() },
          acceptInput: (input) => input === "/overview",
        },
        {
          command: "/reset",
          description: "Reset all settings and research data",
          action: () => {
            this.configModel.reset()
            this.researchNotes.reset()
            initConfig(this);
            this.addNoAiMessage(
              "All settings and research data have been reset.",
            );
            return null;
          },
          acceptInput: (input) => input === "/reset",
        },
        {
          command: "/reset-history",
          description: "Reset the chat history",
          action: () => {
            this.messageHistory.init();
            this.addNoAiMessage("Chat history has been reset.");
            return null;
          },
          acceptInput: (input) => input === "/reset-history",
        },
        {
          command: "/research",
          description: "Start research mode with a goal",
          usage: " <goal>",
          action: () => {
            const goal = userInput.slice(10).trim();
            if (!goal) {
              this.addNoAiMessage(
                "Please specify a research goal. Usage: /research <your research goal>",
              );
              return null;
            }
            this.researchNotes.reset()
            this.researchButton.show();
            this.addNoAiMessage(
              `Research mode activated. Goal: "${goal}"\nI will analyze each page you visit based on this research goal.`,
            );
            return null;
          },
          acceptInput: (input) => input.startsWith("/research "),
        },
        {
          command: "/stop-research",
          description: "Stop research mode",
          action: () => {
            if (!this.configModel.get('research_goal')) {
              this.addNoAiMessage("Research mode is not active.");
              return null;
            }
            this.researchNotes.reset();
            this.researchButton.hide();
            this.addNoAiMessage("Research mode deactivated.");
            return null;
          },
          acceptInput: (input) => input === "/stop-research",
        },
        {
          command: "/reanalyze",
          description: "Re-analyze the current page",
          action: async () => {
            if (!this.configModel.get('research_goal')) {
              this.addNoAiMessage("Research mode is not active.");
              return null;
            }
            return this.analyzePageForResearch();
          },
          acceptInput: (input) => input === "/reanalyze",
        },
        {
          command: "/notes",
          description: "Show collected research notes",
          action: () => {
            if (!this.configModel.get('research_goal')) {
              this.addNoAiMessage("Research mode is not active.");
              return null;
            }
            if (this.researchNotes.empty()) {
              this.addNoAiMessage("No research notes collected yet.");
              return null;
            }
            const relevantNotes = this.researchNotes.filter(
              (note) => note.isRelevant,
            );
            const notRelevantCount =
              this.researchNotes.count() - relevantNotes.length;

            let message = `# Research Notes\nGoal: "${this.configModel.get('research_goal')}"\n\n`;
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
          acceptInput: (input) => input === "/notes",
        },
      ];

      if (!input.startsWith("/")) return input;

      for (const command of commands) {
        if (command.acceptInput(input)) {
          return command.action();
        }
      }

      this.addNoAiMessage(
        "Unknown command. Type /help for a list of available commands.",
      );
      return null;
    }

    setStatus(message, type = 'info') {
      const icons = {
        info: 'ℹ️',
        error: '⚠️',
        warning: '⚡',
        success: '✅'
      };
      
      this.statusBar.innerHTML = `${icons[type]} ${message}`;
      this.statusBar.className = `status-bar status-${type}`;
    }
  }

  async function initConfig(chatModal) {
    chatModal.showPanel();
    chatModal.showConfigPanel();
  }

  function createShadowRoot() {
    const container = _node('div')
      .attr({
        style: "all: initial; position: fixed; z-index: 9999;",
      })
      .build();
    document.body.appendChild(container);

    return container.attachShadow({ mode: "open" });
  }

  function openChat(selection) {
    CHAT_MODAL.showPanel(selection);
  }

  class AssistantButton {
    constructor(shadowRoot) {
      this.shadowRoot = shadowRoot;
      this.button = _node('button')
        .attr({
          id: "assistant-btn",
          innerText: "✨",
          title: "Talk about page content",
        })
        .build();

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

      // Add event listeners
      this.button.addEventListener("mousedown", this.dragStart);
      document.addEventListener("mousemove", this.drag);
      document.addEventListener("mouseup", this.dragEnd);

      this.shadowRoot.appendChild(this.button);
    }

    dragStart(e) {
      if (window.getSelection().rangeCount > 0) {
        this.currentSelection = window
          .getSelection()
          .getRangeAt(0)
          .cloneRange();
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
        if (
          Math.abs(this.currentX - this.initialX) < 5 &&
          Math.abs(this.currentY - this.initialY) < 5
        ) {
          openChat(this.currentSelection);
          return;
        }

        this.initialX = this.currentX;
        this.initialY = this.currentY;
      }
    }

    hide() {
      this.button.classList.add("hidden");
    }

    show() {
      this.button.classList.remove("hidden");
    }
  }

  class ResearchButton {
    constructor(shadowRoot, chatModal) {
      this.shadowRoot = shadowRoot;
      this.chatModal = chatModal;
      this.button = _node('button')
        .attr({
          id: "research-btn",
          innerText: "🔍",
          title: "Analyze page for research",
        })
        .build();
      this.button.style.display = "none";

      this.analyzing = false;
      this.analyzed = false;

      this.button.addEventListener("click", () => this.handleClick());
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
      this.button.innerText = "⌛";
      this.button.title = "Analyzing page...";

      try {
        const insights = await this.chatModal.analyzePageForResearch();
        if (insights) {
          // Store insights for when panel is opened
          this.chatModal.pendingInsights = insights.content;

          // Update button state
          this.analyzed = true;
          this.button.innerText = "✅";
          this.button.title = "View research insights";
        } else {
          // Error occurred during analysis
          this.button.innerText = "❌";
          this.button.title = "Error analyzing page. Click to retry.";
          this.analyzed = false;
        }
      } catch (error) {
        console.error("Error in research button:", error);
        this.button.innerText = "❌";
        this.button.title = "Error analyzing page. Click to retry.";
        this.analyzed = false;
      }

      this.analyzing = false;
    }

    show() {
      this.button.style.display = "block";
      // Reset state when showing
      this.analyzing = false;
      this.analyzed = false;
      this.button.innerText = "🔍";
      this.button.title = "Analyze page for research";
    }

    hide() {
      this.button.style.display = "none";
    }
  }


  function ignoreKeyStrokesWhenInputHasFocus(shadowRoot, inputElement) {
    function stopPropagation(e) {
      // Check if the input is actually focused
      if (shadowRoot.activeElement !== inputElement) return;
      if (e.key === "Escape" || e.key === "Enter") return;

      e.stopImmediatePropagation();
      e.stopPropagation();
    }

    // List of events to capture and potentially stop
    const eventsToCapture = ["keydown", "keyup", "keypress", "input"];

    function attachListeners() {
      eventsToCapture.forEach((eventType) => {
        document.addEventListener(eventType, stopPropagation, {
          capture: true, // Use capturing phase to intercept events early
          passive: false, // Ensure we can call stopPropagation
        });
      });
    }

    function removeListeners() {
      eventsToCapture.forEach((eventType) => {
        document.removeEventListener(eventType, stopPropagation, {
          capture: true,
        });
      });
    }

    // Attach listeners when input is focused
    inputElement.addEventListener("focus", attachListeners);

    // Remove listeners when input loses focus
    inputElement.addEventListener("blur", removeListeners);

    // Optional: Add direct event listeners to the input
    inputElement.addEventListener("keydown", (e) => {
      // Prevent default for specific keys if needed
      if (e.key === "Escape") {
        inputElement.blur();
      }
    });
  }

  function createTypingIndicator() {
    const typingContainer = _node('div')
      .attr({ className: "typing-indicator chat-message assistant" })
      .html(`
            <div class="typing-dots">
                <span class="dot"></span>
                <span class="dot"></span>
                <span class="dot"></span>
            </div>
        `)
      .build();
    return typingContainer;
  }

  function addStyling(shadowRoot) {
    const style = _node('style')
      .text(`
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

            .status-bar {
                padding: 8px 15px;
                background-color: #f8f9fa;
                border-top: 1px solid #e0e0e0;
                color: #666;
                font-size: 12px;
                text-align: left;
                border-radius: 0 0 8px 8px;
                flex-shrink: 0;
                display: flex;
                align-items: center;
                height: 20px;
            }

            // Update chat-content max-height to account for status bar
            .chat-content {
                max-height: calc(85vh - 180px);
            }

            .status-bar.status-error {
                color: #dc3545;
                background-color: #fff5f5;
            }

            .status-bar.status-warning {
                color: #856404;
                background-color: #fff3cd;
            }

            .status-bar.status-success {
                color: #28a745;
                background-color: #f4fff5;
            }

            .status-bar.status-info {
                color: #666;
                background-color: #f8f9fa;
            }
        `)
      .build();
    shadowRoot.appendChild(style);
  }

  function addTypingStyle(shadowRoot) {
    const style = _node('style')
      .text(`
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
        `)
      .build();
    shadowRoot.appendChild(style);
  }

  function _$(target) {
    return {
      q: function (selector) {
        return target.querySelector(selector);
      },
      value: function (selector) {
        return target.querySelector(selector)?.value;
      },
      qa: function (selector) {
        return target.querySelectorAll(selector);
      },
      node: function (selector) { 
        return _node(target.querySelector(selector))
      }
    };
  }

  function _node(el) {
    if (typeof el === 'string') {
      el = document.createElement(el);
    } 
    else if (el.isWrapper) {
      return el
    }
    else if (!(el instanceof Element) && !(el instanceof ShadowRoot)) {
      console.error('Invalid element type:', el);
      throw new Error('_node requires either a string tag name, a DOM element, or a ShadowRoot');
    }
    const wrapper = {
      isWrapper: true,
      children: (...children) => {
        children.forEach(child => {
          if (!child) return;
          if (child.isWrapper) {
            el.appendChild(child.build());
          } else if (child instanceof Element || child instanceof ShadowRoot) {
            el.appendChild(child);
          } else if (typeof child === 'string' || typeof child === 'number') {
            el.appendChild(document.createTextNode(child.toString()));
          } else {
            console.error('Invalid child type:', child);
            throw new Error('Invalid child type');
          }
        });
        return wrapper;
      },
      attr: (attrs) => {
        Object.entries(attrs).forEach(([key, value]) => {
          el[key] = value;
        });
        return wrapper;
      },
      on: (event, handler) => {
        el.addEventListener(event, handler);
        return wrapper;
      },
      html: (html) => {
        el.innerHTML = html;
        return wrapper;
      },
      text: (text) => {
        el.textContent = text;
        return wrapper;
      },
      build: (callback) => {
        if (callback) callback(el);
        return el;
      }
    };
    return wrapper;
  }

  function _div(className) {
    const el = document.createElement('div');
    if (className) el.className = className;
    return el;
  }

  async function handleToolCalls(message) {
    // TODO: handle tool calls
    return message.content;
  }

  main();
})();

class OverviewAgent {
    constructor(configModel, options = {}) {
        this.configModel = configModel;
        this.options = {
            chunkSize: 2000,  // characters per chunk
            chunkOverlap: 200,  // characters of overlap between chunks
            ...options
        };
    }

    /**
     * Split text into overlapping chunks
     * @private
     */
    _splitIntoChunks(text) {
        const chunks = [];
        let currentIndex = 0;
        
        while (currentIndex < text.length) {
            const chunkEnd = Math.min(currentIndex + this.options.chunkSize, text.length);
            let chunk = text.substring(currentIndex, chunkEnd);
            
            // If this isn't the last chunk, try to break at a sentence or paragraph
            if (chunkEnd < text.length) {
                const breakPoints = [
                    chunk.lastIndexOf('\n\n'),  // paragraph
                    chunk.lastIndexOf('. '),    // sentence
                    chunk.lastIndexOf('? '),    // question
                    chunk.lastIndexOf('! ')     // exclamation
                ].filter(point => point !== -1);
                
                if (breakPoints.length > 0) {
                    const breakPoint = Math.max(...breakPoints);
                    chunk = chunk.substring(0, breakPoint + 1);
                    currentIndex += breakPoint + 1;
                } else {
                    currentIndex += chunk.length - this.options.chunkOverlap;
                }
            } else {
                currentIndex = text.length;
            }
            
            chunks.push(chunk.trim());
        }
        
        return chunks;
    }

    /**
     * Process content and generate overview with progress reporting
     * @param {string} content - The page content to analyze
     * @param {function} progressCallback - Callback for progress updates
     * @returns {Promise<string>} The generated overview
     */
    async process(content, progressCallback = () => {}, errorCallback = () => {}) {
      console.log(content);
      console.log(content.split(" ").length*3/4);
      let overviewResult = this.processSingleChunkStrategy(content, progressCallback, errorCallback);
      if (overviewResult) return overviewResult;

      return this.processChunkStrategy(content, progressCallback, errorCallback);
    }

    async processSingleChunkStrategy(content, progressCallback = () => {}, errorCallback = () => {}) {
      const history = new ChatHistory(this.configModel);
      let overviewPrompt = `
        Based on the overview provided above, structure the information as follows:
        - Add a short introduction about the general subject of the page
        - Create an outline of the main topics, similar to a table of contents
        - Explore the main topics shortly as bullet points with a short explanation of each topic
        - If a topic is about an external story, include a link to the story, use markdown links
        - When creating outlines, don't add empty topics and don't add duplicate topics
        - Ignore content that is part of structure and navigation, such as headers, menus, footers, etc.
      `;
      history.userMessage(
        `
        --- begin content ---\n
        ${content}
        --- end content ---\n\n
        If you see "--- begin content ---" and "--- end content ---", respond based on the content between them. 
        If you do not see "--- begin content ---", respond only with "Unable to see the whole context."

        ${overviewPrompt}".
        `
        );

      progressCallback('Will try to generate overview with single chunk strategy');
      
      const response = await sendQueryToLLM(this.configModel, history);
      const text = response.choices[0].message.content.trim();
      if (text.includes("Unable to see whole content")) 
        return null;

      progressCallback('Overview generated with single chunk strategy');
      
      return text;
    }

    async processChunkStrategy(content, progressCallback = () => {}, errorCallback = () => {}) {
        try {
            // Split content into chunks
            const chunks = this._splitIntoChunks(content);
            progressCallback(`Split content into ${chunks.length} chunks`);

            // Process each chunk
            const chunkSummaries = [];
            for (let i = 0; i < chunks.length; i++) {
                progressCallback(`Processing chunk ${i + 1} of ${chunks.length}`);
                
                const history = new ChatHistory(this.configModel);
                history.userMessage("Please provide a concise summary of the following text segment. Focus on the main points and key information: \n\n" + chunks[i]);
                
                const response = await sendQueryToLLM(this.configModel, history);
                const summary = response.choices[0].message.content;
                chunkSummaries.push(summary); 
            }

            // Combine summaries
            progressCallback('Generating final overview...');
            const history = new ChatHistory(this.configModel);
            history.userMessage(
                "Please combine these summaries into a coherent overview. Organize the information logically and remove any redundancies:\n\n" + 
                chunkSummaries.join('\n\n')
            );
            
            const response = await sendQueryToLLM(this.configModel, history);
            progressCallback(`Overview generated out of ${chunks.length} chunks`);
            return response.choices[0].message.content;

        } catch (error) {
          errorCallback('Error during overview generation: ' + error.message);
          throw error;
        }
    }    
}

function getPageContent() {
    return getPageContentNaive();
}

class ConfigModel {
  constructor(initialConfig) {
  const defaultConfig = {
      llm: null,
      prompt: `You are a helpful assistant with the ability to answer questions about the current page content.`,
      chat_url: "http://localhost:11434/v1/chat/completions",
      models_url: "http://localhost:11434/v1/models",
      research_mode: false,
      research_goal: null,
    };      
    this.config = initialConfig || defaultConfig;
    this.listeners = new Set();
  }

  addListener(listener) {
    this.listeners.add(listener);
  }

  removeListener(listener) {
    this.listeners.delete(listener);
  }

  async reset() {
    await this.update(defaultConfig);
  }

  async set(key, value) {
    await this.update({...this.config, [key]: value });
  }

  async update(changes) {
    const newConfig = { ...this.config, ...changes };
    if (JSON.stringify(newConfig) !== JSON.stringify(this.config)) {
      this.config = newConfig;
      await GM.setValue("config", newConfig);
      this.notifyListeners();
    }
  }

  get(key) {
    return this.config[key];
  }

  getAll() {
    return { ...this.config };
  }

  notifyListeners() {
    for (const listener of this.listeners) {
      listener(this.config);
    }
  }
}

class ResearchAgent {
  constructor(configModel, researchNotesModel) {
    this.researchNotesModel = researchNotesModel;
    this.currentPageAnalyzed = false;
    this.configModel = configModel;
  }

  isAnalysisRequired() {
    return ! this.currentPageAnalyzed && this.configModel.get('research_goal');
  }

  async analyzePageForResearch(content, messageHistory) {

    const currentUrl = window.location.href;
    const prompt = `You must respond ONLY with a JSON object in the following format, with NO additional text before or after:
{
    "summary": "a very brief summary of the page (max 50 words)",
    "isRelevant": true or false (boolean value, no quotes)
}

Analyze the following insights about a webpage in relation to the research goal: "${this.configModel.get('research_goal')}"

Insights to analyze:
${content}`;

    try {
      messageHistory.userMessage(prompt);
      const response = await sendQueryToLLM(this.configModel, messageHistory);
      const aiMessage = response.choices[0].message.content.trim();

      // Try to extract JSON if it's wrapped in other text
      let jsonStr = aiMessage;
      const jsonMatch = aiMessage.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        jsonStr = jsonMatch[0];
      }

      let analysis = JSON.parse(jsonStr);

      // Validate the required fields
      if (typeof analysis.summary !== "string" || typeof analysis.isRelevant !== "boolean") {
        return "Failed to parse AI response as JSON"
      }

      const note = {
        url: currentUrl,
        summary: analysis.summary,
        insights: content,
        isRelevant: analysis.isRelevant,
        timestamp: new Date().toISOString(),
      };

      await this.researchNotes.addNote(note);

      this.currentPageAnalyzed = true;

      // Add a message about the page's relevance
      return analysis.isRelevant
        ? "✅ This page has been added to your research notes."
        : "❌ This page was analyzed but deemed not relevant to your research goal.";
    } catch (error) {
      console.error("Error processing research note:", error);
      console.error("AI response:", error.aiResponse);
      return "⚠️ Error processing research note. The page was analyzed but couldn't be added to research notes." +
        "Check the console for more insights.";
    }
  }
}

class ResearchNotesModel {
  constructor(researchNotes) {
    this.notes = researchNotes;
  }

  async addNote(note) {
    this.notes.push(note);
    await this.persist();
  }

  getNotes() {
    return this.notes;
  }
  
  async persist() {
    await GM.setValue("research_notes", this.notes);
  }

  empty() {
    return this.notes.length === 0; 
  }

  filter(predicate) {
    return this.notes.filter(predicate);
  }

  count() {
    return this.notes.length;
  }
  
  async reset() {
    this.notes = [];
    await this.persist();
  }
}

class ChatHistory {
  constructor(configModel) {
    this.history = [];
    this.configModel = configModel;
  }

  init() {
    this.history = [{ role: "system", content: this.configModel.get('prompt') }];
    this.configModel.addListener((config) => {
      this.history.push({ role: "system", content: config.prompt });
    });
    this.userMessage(
      "This is the current page content: \n" + getPageContent(),
    );
  }

  aiMessage(message) {
    this.history.push({ role: "assistant", content: message });
  }

  userMessage(message) {
    this.history.push({ role: "user", content: message });
  }

  lastMessage() {
    return this.history[this.history.length - 1];
  }
  getHistory() {
    return this.history;
  }
}

function getPageContent() {
  return getPageContentNaive();
}

function getPageContentAsMarkdown() {
  var turndownService = new TurndownService()
  return turndownService.turndown(document.body);
}


function getPageContentNaive() {
  // Create a temporary div to hold the page content
  const tempDiv = document.createElement("div");
  tempDiv.innerHTML = document.body.innerHTML;

  // Remove all script and style tags
  const scriptsAndStyles = tempDiv.querySelectorAll("script, style");
  scriptsAndStyles.forEach((element) => element.remove());

  // Function to process a node and its children
  function processNode(node) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      // If it's a link, preserve it
      if (node.tagName === "A" && node.href) {
        return `[${node.textContent}](${node.href}) `;
      }
      if (node.tagName.startsWith("H")) {
        let level = parseInt(node.tagName.slice(1));
        return "#".repeat(level*2) + node.textContent + "\n";
      }
      if (node.tagName === "B") {
        return "**" + processNode(node.childNodes) + "**\n";
      }

      // For other elements, process their children
      let text = "";
      for (let child of node.childNodes) {
        text += processNode(child);
      }
      return text;
    } else if (node.nodeType === Node.TEXT_NODE) {
      // Return text content for text nodes
      return node.textContent;
    }
    return "";
  }

  return processNode(tempDiv);
}

async function sendQueryToLLM(configModel, messageHistory) {
  let req = {
    model: configModel.get('llm'),
    stream: false,
    messages: messageHistory.getHistory(),
    //"tools": availableTools
  };
  
  let headers = {};
  if (configModel.get('apiToken')) {
    headers["Authorization"] = `Bearer ${configModel.get('apiToken')}`;
  }
  const response = await fetch(`${configModel.get('chat_url')}`, {
    method: "POST",
    headers: {
      ...headers,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(req),
  });
  if (response.ok) return await response.json();

  if (response.status === 401)
    throw new Error("Unauthorized, invalid API token");

  if (response.status === 403)
    throw new Error("Forbidden, check your API token");

  if (response.status >= 400 && response.status < 500) {
    let errorMessage = await response.json();
    throw new Error(errorMessage.error.message);
  }
  throw new Error(
    "Failed to communicate with LLM!! \n" + response.statusText,
  );
}