const fs = require("fs");
const path = require("path");
const util = require("util");
const exec = util.promisify(require("child_process").exec);
const axios = require("axios");
var { spawn } = require("child_process");
const { observable } = require("mobx");
const { ComfyUIClient } = require("./comfyui_client");

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
        const serverAddress = `127.0.0.1:${port}`;
        const clientId = Math.floor(Math.random() * 4294967294);
        const client = new ComfyUIClient(serverAddress, clientId);
        await client.connect();

        clients.push({ client: client, free: true });
      } catch (ex) {
        console.log(ex);
      }
    }
    // Execute the callback with servers running
    return await callback();

  } finally {
    // Always stop servers when done, even if callback throws
    ports.forEach(port =>
      killProcessOnPort(port)
    )
  }
}

exports.createFolderIfNotExist = createFolderIfNotExist;
exports.executeExternalHelper = executeExternalHelper;
exports.splitArrayIntoChunks = splitArrayIntoChunks;
exports.registerExitCallback = registerExitCallback;
exports.withComfyUIServers = withComfyUIServers;
exports.isServerRunning = isServerRunning;
exports.startComfyUIServer = startComfyUIServer;
exports.ensureServerRunning = ensureServerRunning;
