require('dotenv').config();
const fs = require("fs");
const path = require("path");
const util = require("util");
const exec = util.promisify(require("child_process").exec);
const axios = require("axios");
var { spawn } = require("child_process");
const { observable } = require("mobx");
const { ComfyUIClient } = require("./comfyui_client");

const COMFYUI_HOST = process.env.COMFYUI_HOST || '127.0.0.1';
const COMFYUI_PORT_1 = parseInt(process.env.COMFYUI_PORT_1 || '8188', 10);
const COMFYUI_PORT_2 = parseInt(process.env.COMFYUI_PORT_2 || '8189', 10);
const COMFYUI_ROOT = process.env.COMFYUI_ROOT || "H:\\comfyui_root";
const COMFYUI_BATCH_FILE_1 = process.env.COMFYUI_BATCH_FILE_1 || "H:\\comfyui_root\\run_nvidia_gpu - 1.bat";
const COMFYUI_BATCH_FILE_2 = process.env.COMFYUI_BATCH_FILE_2 || "H:\\comfyui_root\\run_nvidia_gpu - 2.bat";

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
    `${command} "${tempInputJson}" "${tempOutputJson}" ${additionalParams ?? ""}`
  );

  if (fs.existsSync(tempOutputJson)) {
    return JSON.parse(fs.readFileSync(tempOutputJson, "utf8"));
  } else if (stderr) {
    console.warn("stderr:", stderr);
  }
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
    await axios.get(`http://${COMFYUI_HOST}:${port}/system_stats`, { timeout: 2000 });
    return true;
  } catch (ex) {
    return false;
  }
}

// Helper function to kill process using a specific port on Windows
async function killProcessOnPort(port) {
  try {
    // Find PID using the port
    const { stdout } = await exec(`netstat -ano | findstr :${port}`);
    const lines = stdout.split('\n').filter(line => line.includes('LISTENING'));

    if (lines.length > 0) {
      // Extract PID from the last column
      const pidMatch = lines[0].trim().split(/\s+/).pop();
      if (pidMatch) {
        const pid = parseInt(pidMatch);
        console.log(`Found process ${pid} using port ${port}, killing it...`);

        // Kill the process tree
        await exec(`taskkill /F /T /PID ${pid}`);
        console.log(`Successfully killed process on port ${port}`);

        // Wait a bit for port to be released
        await new Promise(resolve => setTimeout(resolve, 2000));
        return true;
      }
    }
  } catch (ex) {
    // Port might not be in use, which is fine
    console.log(`No process found on port ${port} or already freed`);
  }
  return false;
}

// Helper function to start ComfyUI server
async function startComfyUIServer(port) {
  const batchFiles = {
    [COMFYUI_PORT_1]: COMFYUI_BATCH_FILE_1,
    [COMFYUI_PORT_2]: COMFYUI_BATCH_FILE_2
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
    cwd: COMFYUI_ROOT,
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

  // Kill any existing process on this port before starting
  await killProcessOnPort(port);
  if (await isServerRunning(port)) {
    console.log(`ComfyUI server on port ${port} is already running`);
    return true;
  }

  console.log(`ComfyUI server on port ${port} is not running, starting it...`);
  return await startComfyUIServer(port);
}

// Wrapper function that manages ComfyUI server lifecycle
async function withComfyUIServers(ports, callback) {
  const startedServers = [];

  // Register cleanup handler for process termination
  registerExitCallback(async () => {
    ports.forEach(port =>
      killProcessOnPort(port)
    )
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
    const clients = observable([]);

    for (let port of ports) {
      try {
        const serverAddress = `${COMFYUI_HOST}:${port}`;
        const clientId = Math.floor(Math.random() * 4294967294);
        const client = new ComfyUIClient(serverAddress, clientId);
        await client.connect();

        clients.push({ client: client, free: true });
      } catch (ex) {
        console.log(ex);
      }
    }
    // Execute the callback with servers running
    return await callback(clients);

  } finally {
    // Always stop servers when done, even if callback throws
    ports.forEach(port =>
      killProcessOnPort(port)
    )
  }
}

// Wrapper function that connects to external ComfyUI servers (remote machines)
// Reads server addresses from .env: EXTERNAL_COMFYUI_HOST_1, EXTERNAL_COMFYUI_PORT_1, etc.
async function withExternalComfyuiServers(callback) {
  const externalServers = [];

  // Collect all external server configs from .env
  let index = 1;
  while (process.env[`EXTERNAL_COMFYUI_HOST_${index}`]) {
    const host = process.env[`EXTERNAL_COMFYUI_HOST_${index}`];
    const port = parseInt(process.env[`EXTERNAL_COMFYUI_PORT_${index}`] || '8188', 10);
    externalServers.push({ host, port });
    index++;
  }

  if (externalServers.length === 0) {
    console.log('No external ComfyUI servers configured in .env');
    return;
  }

  console.log(`Connecting to external ComfyUI servers: ${externalServers.map(s => `${s.host}:${s.port}`).join(', ')}`);

  const clients = observable([]);

  for (const server of externalServers) {
    try {
      const serverAddress = `${server.host}:${server.port}`;
      const clientId = Math.floor(Math.random() * 4294967294);
      const client = new ComfyUIClient(serverAddress, clientId);
      await client.connect();

      clients.push({ client: client, free: true });
      console.log(`Connected to external server ${serverAddress}`);
    } catch (ex) {
      console.log(`Failed to connect to external server ${server.host}:${server.port}:`, ex.message);
    }
  }

  if (clients.length === 0) {
    console.log('No external ComfyUI servers could be connected');
    return;
  }

  // Register exit callback to free models on unexpected termination
  const freeModelsOnExit = async () => {
    for (const { client } of clients) {
      try {
        await axios.post(`http://${client.serverAddress}/free`);
        console.log(`Freed models on ${client.serverAddress}`);
      } catch (ex) {
        // Silently ignore errors during forced cleanup
      }
    }
  };
  registerExitCallback(freeModelsOnExit);

  try {
    return await callback(clients);
  } finally {
    await freeModelsOnExit();
  }
}

exports.createFolderIfNotExist = createFolderIfNotExist;
exports.executeExternalHelper = executeExternalHelper;
exports.splitArrayIntoChunks = splitArrayIntoChunks;
exports.registerExitCallback = registerExitCallback;
exports.withComfyUIServers = withComfyUIServers;
exports.withExternalComfyuiServers = withExternalComfyuiServers;
exports.isServerRunning = isServerRunning;
exports.startComfyUIServer = startComfyUIServer;
exports.ensureServerRunning = ensureServerRunning;
