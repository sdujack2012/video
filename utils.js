const fs = require("fs");
const path = require("path");
const kill = require("tree-kill");
const util = require("util");
const exec = util.promisify(require("child_process").exec);
const axios = require("axios");
var Client = require("socket.engine").client;
var { spawn } = require("child_process");

function createFolderIfNotExist(...pathParts) {
  const folderPath = path.resolve(...pathParts);
  if (!fs.existsSync(folderPath)) {
    fs.mkdirSync(folderPath, { recursive: true });
  }
  return folderPath;
}

function splitArrayIntoChunks(array, chunkSplitLimit) {
  // split clips into chunks
  const chunkSize = Math.ceil(
    array.length / Math.ceil(array.length / chunkSplitLimit)
  );
  const chunks = [];
  for (let i = 0; i < array.length; i += chunkSize) {
    chunks.push(array.slice(i, i + chunkSize));
  }
  return chunks;
}

async function executeExternalHelper(command, inputJson, additionalParams) {
  createFolderIfNotExist(path.resolve("temp"));
  const tempInputJson = path.resolve("temp", `temp_${Math.random()}.json`);
  fs.writeFileSync(tempInputJson, JSON.stringify(inputJson));
  const tempOutputJson = path.resolve("temp", `temp_${Math.random()}.json`);
  const { stderr } = await exec(
    `${command} "${tempInputJson}" "${tempOutputJson}" ${additionalParams}`
  );

  if (fs.existsSync(tempOutputJson)) {
    return JSON.parse(fs.readFileSync(tempOutputJson, "utf8"));
  } else if (stderr) {
    console.warn("stderr:", stderr);
  }
}

async function startOllama() {
  const child = spawn("ollama", ["run", "llama3_custom"]);

  return {
    terminate: () => kill(child.pid),
  };
}

async function createAiSession(hostChannel) {
  const child = spawn("python", ["ai_session.py"]);
  child.stdout.setEncoding("utf8");
  const clientChannel = `${Math.random()}#client`;

  const promise = new Promise((resolve) => {
    child.stdout.on("data", function (data) {
      console.log("stdout: " + data);
      resolve();
    });
  });
  await promise;

  child.stderr.setEncoding("utf8");
  child.stderr.on("data", function (data) {
    //Here is where the error output goes

    console.log("stderr: " + data);

    data = data.toString();
  });

  child.on("close", function (code) {
    //Here you can get the exit code of the script

    console.log("closing code: " + code);
  });

  const c = new Client();
  c.start();

  return {
    terminate: () => kill(child.pid),
    getDataFromHost: async () => {
      const promise = new Promise((resolve) => {
        c.on(clientChannel, (data) => {
          resolve(data);
        });
      });
      return await promise;
    },
    writeDataToHost: (data, action) =>
      c.write(hostChannel, { data, clientChannel, action }),
  };
}

function registerExitCallback(callback) {
  process.on("exit", () => {
    callback();
    setTimeout(() => {
      process.exit();
    }, 1000);
  });

  // catches ctrl+c event
  process.on("SIGINT", () => {
    callback();
    setTimeout(() => {
      process.exit();
    }, 1000);
  });

  // catches "kill pid" (for example: nodemon restart)
  process.on("SIGUSR1", () => {
    callback();
    setTimeout(() => {
      process.exit();
    }, 1000);
  });

  process.on("SIGUSR2", () => {
    callback();
    setTimeout(() => {
      process.exit();
    }, 1000);
  });
}

// Track server processes
const serverProcesses = [];

// Helper function to check if ComfyUI server is responding
async function isServerRunning(port) {
  try {
    await axios.get(`http://127.0.0.1:${port}/system_stats`, { timeout: 2000 });
    return true;
  } catch (ex) {
    return false;
  }
}

// Helper function to start ComfyUI server
async function startComfyUIServer(port) {
  const batchFiles = {
    8188: "H:\\comfyui_root\\run_nvidia_gpu - 1.bat",
    8189: "H:\\comfyui_root\\run_nvidia_gpu - 2.bat"
  };

  const batchFile = batchFiles[port];
  if (!batchFile) {
    console.log(`No batch file configured for port ${port}`);
    return false;
  }

  if (!fs.existsSync(batchFile)) {
    console.log(`Batch file not found: ${batchFile}`);
    return false;
  }

  console.log(`Starting ComfyUI server on port ${port}...`);

  // Start the batch file in a hidden window
  const serverProcess = spawn('cmd.exe', ['/c', `"${batchFile}"`], {
    stdio: 'ignore',
    shell: true,
    cwd: 'H:\\comfyui_root',
    windowsHide: true
  });

  serverProcess.unref();
  serverProcesses.push({ port, process: serverProcess });

  // Wait for server to become ready (max 60 seconds)
  const maxWaitTime = 60000;
  const checkInterval = 2000;
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitTime) {
    await new Promise(resolve => setTimeout(resolve, checkInterval));
    if (await isServerRunning(port)) {
      console.log(`ComfyUI server on port ${port} is ready`);
      return true;
    }
    console.log(`Waiting for ComfyUI server on port ${port}...`);
  }

  console.log(`Timeout waiting for ComfyUI server on port ${port}`);
  return false;
}

// Helper function to ensure server is running before connecting
async function ensureServerRunning(port) {
  if (await isServerRunning(port)) {
    console.log(`ComfyUI server on port ${port} is already running`);
    return true;
  }

  console.log(`ComfyUI server on port ${port} is not running, starting it...`);
  return await startComfyUIServer(port);
}

// Helper function to stop ComfyUI servers
async function stopComfyUIServers() {
  console.log('Stopping ComfyUI servers...');

  // Send interrupt and free memory to both servers if they're running
  const ports = [8188, 8189];

  for (const port of ports) {
    if (await isServerRunning(port)) {
      try {
        // Try to gracefully shut down via API
        await axios.post(`http://127.0.0.1:${port}/interrupt`, {}, { timeout: 5000 });
        console.log(`Interrupted tasks on port ${port}`);

        // Give it a moment to clean up
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (ex) {
        console.log(`Could not interrupt server on port ${port}: ${ex.message}`);
      }
    }
  }

  // Kill the spawned processes
  for (const serverInfo of serverProcesses) {
    try {
      // On Windows, use taskkill to kill the entire process tree
      await exec(`taskkill /F /T /PID ${serverInfo.process.pid}`);
      console.log(`Stopped ComfyUI server on port ${serverInfo.port}`);
    } catch (ex) {
      console.log(`Could not stop server on port ${serverInfo.port}: ${ex.message}`);
    }
  }

  serverProcesses.length = 0;
}

// Wrapper function that manages ComfyUI server lifecycle
async function withComfyUIServers(ports, callback) {
  const startedServers = [];

  // Register cleanup handler for process termination
  registerExitCallback(async () => {
    await stopComfyUIServers();
  });

  try {
    // Start required servers concurrently
    const startPromises = ports.map(async (port) => {
      const wasStarted = await ensureServerRunning(port);
      if (wasStarted) {
        startedServers.push(port);
      }
      return wasStarted;
    });

    await Promise.all(startPromises);

    // Execute the callback with servers running
    return await callback();

  } finally {
    // Always stop servers when done, even if callback throws
    await stopComfyUIServers();
  }
}

exports.createFolderIfNotExist = createFolderIfNotExist;
exports.executeExternalHelper = executeExternalHelper;
exports.createAiSession = createAiSession;
exports.splitArrayIntoChunks = splitArrayIntoChunks;
exports.startOllama = startOllama;
exports.registerExitCallback = registerExitCallback;
exports.withComfyUIServers = withComfyUIServers;
exports.isServerRunning = isServerRunning;
exports.startComfyUIServer = startComfyUIServer;
exports.ensureServerRunning = ensureServerRunning;
exports.stopComfyUIServers = stopComfyUIServers;
