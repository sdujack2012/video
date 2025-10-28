const WebSocket = require("ws");
const ComfyUIClient = class {
  serverAddress;
  clientId;
  ws;
  constructor(serverAddress, clientId) {
    this.serverAddress = serverAddress;
    this.clientId = clientId;
  }
  connect() {
    return new Promise(async (resolve, reject) => {
      if (this.ws) {
        await this.disconnect();
      }
      const url = `ws://${this.serverAddress}/ws?clientId=${this.clientId}`;
      this.ws = new WebSocket(url, {
        perMessageDeflate: false,
      });
      this.ws.on("open", () => {
        resolve();
      });
      this.ws.on("close", () => { });
      this.ws.on("error", (err) => {
        console.log(err);
        reject("Fail to connect");
      });
    });
  }
  async disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = void 0;
    }
  }
  async getEmbeddings() {
    const res = await fetch(`http://${this.serverAddress}/embeddings`);
    const json = await res.json();
    if ("error" in json) {
      throw new Error(JSON.stringify(json));
    }
    return json;
  }
  async getExtensions() {
    const res = await fetch(`http://${this.serverAddress}/extensions`);
    const json = await res.json();
    if ("error" in json) {
      throw new Error(JSON.stringify(json));
    }
    return json;
  }
  async queuePrompt(prompt) {
    const res = await fetch(`http://${this.serverAddress}/prompt`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt,
        client_id: this.clientId,
      }),
    });
    const json = await res.json();
    if ("error" in json) {
      throw new Error(JSON.stringify(json));
    }
    return json;
  }
  async interrupt() {
    const res = await fetch(`http://${this.serverAddress}/interrupt`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
    });
    const json = await res.json();
    if ("error" in json) {
      throw new Error(JSON.stringify(json));
    }
  }
  async editHistory(params) {
    const res = await fetch(`http://${this.serverAddress}/history`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(params),
    });
    const json = await res.json();
    if ("error" in json) {
      throw new Error(JSON.stringify(json));
    }
  }
  async uploadImage(image, filename, overwrite) {
    const formData = new FormData();
    formData.append("image", new Blob([image]), filename);
    if (overwrite !== void 0) {
      formData.append("overwrite", overwrite.toString());
    }
    const res = await fetch(`http://${this.serverAddress}/upload/image`, {
      method: "POST",
      body: formData,
    });
    const json = await res.json();
    if ("error" in json) {
      throw new Error(JSON.stringify(json));
    }
    return json;
  }
  async uploadMask(image, filename, originalRef, overwrite) {
    const formData = new FormData();
    formData.append("image", new Blob([image]), filename);
    formData.append("originalRef", JSON.stringify(originalRef));
    if (overwrite !== void 0) {
      formData.append("overwrite", overwrite.toString());
    }
    const res = await fetch(`http://${this.serverAddress}/upload/mask`, {
      method: "POST",
      body: formData,
    });
    const json = await res.json();
    if ("error" in json) {
      throw new Error(JSON.stringify(json));
    }
    return json;
  }
  async getFile(filename, subfolder, type) {
    const res = await fetch(
      encodeURI(`http://${this.serverAddress}/view?` +
        new URLSearchParams({
          filename,
          subfolder,
          type,
        }))
    );
    const blob = await res.blob();
    return blob;
  }
  async viewMetadata(folderName, filename) {
    const res = await fetch(
      `http://${this.serverAddress}/view_metadata/${folderName}?filename=${filename}`
    );
    const json = await res.json();
    if ("error" in json) {
      throw new Error(JSON.stringify(json));
    }
    return json;
  }
  async getSystemStats() {
    const res = await fetch(`http://${this.serverAddress}/system_stats`);
    const json = await res.json();
    if ("error" in json) {
      throw new Error(JSON.stringify(json));
    }
    return json;
  }
  async getPrompt() {
    const res = await fetch(`http://${this.serverAddress}/prompt`);
    const json = await res.json();
    if ("error" in json) {
      throw new Error(JSON.stringify(json));
    }
    return json;
  }
  async getObjectInfo(nodeClass) {
    const res = await fetch(
      `http://${this.serverAddress}/object_info` +
      (nodeClass ? `/${nodeClass}` : "")
    );
    const json = await res.json();
    if ("error" in json) {
      throw new Error(JSON.stringify(json));
    }
    return json;
  }
  async getHistory(promptId) {
    const res = await fetch(
      `http://${this.serverAddress}/history` + (promptId ? `/${promptId}` : "")
    );
    const json = await res.json();
    if ("error" in json) {
      throw new Error(JSON.stringify(json));
    }
    return json;
  }
  async getQueue() {
    const res = await fetch(`http://${this.serverAddress}/queue`);
    const json = await res.json();
    if ("error" in json) {
      throw new Error(JSON.stringify(json));
    }
    return json;
  }

  async getOutputFiles(prompt, filePrefix, fileExtension) {
    if (!this.ws) {
      throw new Error(
        "WebSocket client is not connected. Please call connect() before interacting."
      );
    }
    const queue = await this.queuePrompt(prompt);
    const promptId = queue.prompt_id;
    return new Promise((resolve, reject) => {
      const outputFiles = [];
      const onMessage = async () => {
        try {
          const historyRes = await this.getHistory(promptId);
          const history = historyRes[promptId];
          if (!history) return;
          for (const nodeId of Object.keys(history.outputs)) {
            const nodeOutput = history.outputs[nodeId];
            const allFiles = Object.values(nodeOutput).flatMap(files => files).filter(
              (file) => file.filename &&

                ((!filePrefix || file.filename.startsWith(filePrefix)) &&
                  (!fileExtension || file.filename.endsWith(fileExtension)))
            );
            console.log("allFiles", allFiles);
            const output = [];
            for (const file of allFiles) {
              const blob = await this.getFile(
                file.filename,
                file.subfolder,
                file.type
              );
              output.push({
                blob,
                file,
              });
            }
            outputFiles.push(...output);
          }
          this.ws?.off("message", onMessage);
          return resolve(outputFiles);
        } catch (err) {
          return reject(err);
        }
      };
      this.ws?.on("message", onMessage);
    });
  }

  async getOutputText(prompt) {
    if (!this.ws) {
      throw new Error(
        "WebSocket client is not connected. Please call connect() before interacting."
      );
    }
    const queue = await this.queuePrompt(prompt);
    const promptId = queue.prompt_id;
    const outputTexts = [];
    return new Promise((resolve, reject) => {
      const onMessage = async () => {
        try {
          const historyRes = await this.getHistory(promptId);
          const history = historyRes[promptId];
          if (!history) return;

          for (const nodeId of Object.keys(history.outputs)) {
            const nodeOutput = history.outputs[nodeId];

            const texts = Object.values(nodeOutput).flatMap(text => text).filter(
              text => text
            );
            outputTexts.push(...texts);
          }
          console.log("outputTexts", outputTexts);
          resolve(outputTexts);
          this.ws?.off("message", onMessage);
        } catch (err) {
          return reject(err);
        }
      };
      this.ws?.on("message", onMessage);
    });
  }

  async execute(prompt) {
    if (!this.ws) {
      throw new Error(
        "WebSocket client is not connected. Please call connect() before interacting."
      );
    }
    const queue = await this.queuePrompt(prompt);
    const promptId = queue.prompt_id;
    return promptId;
  }
};

exports.ComfyUIClient = ComfyUIClient;
