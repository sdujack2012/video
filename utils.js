const fs = require("fs");
const path = require("path");
const kill = require("tree-kill");
const util = require("util");
const exec = util.promisify(require("child_process").exec);
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

exports.createFolderIfNotExist = createFolderIfNotExist;
exports.executeExternalHelper = executeExternalHelper;
exports.createAiSession = createAiSession;
exports.splitArrayIntoChunks = splitArrayIntoChunks;
exports.startOllama = startOllama;
exports.registerExitCallback = registerExitCallback;
