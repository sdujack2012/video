const fs = require("fs");
const path = require("path");
const kill  = require('tree-kill');
const util = require("util");
const exec = util.promisify(require("child_process").exec);
var Client = require("socket.engine").client;
var { spawn } = require('child_process');

function createFolderIfNotExist(...pathParts) {
  const folderPath = path.resolve(...pathParts)
  if (!fs.existsSync(folderPath)) {
    fs.mkdirSync(folderPath, { recursive: true });
  }
  return folderPath;
}

async function executeExternalHelper(command, inputJson) {
  createFolderIfNotExist(path.resolve("temp"));
  const tempInputJson = path.resolve("temp", `temp_${Math.random()}.json`);
  const tempOutputJson = path.resolve("temp", `temp_${Math.random()}.json`);
  fs.writeFileSync(tempInputJson, JSON.stringify(inputJson));
  const { stderr } = await exec(
    `${command} "${tempInputJson}" "${tempOutputJson}"`
  );

  if (fs.existsSync(tempOutputJson)) {
    return JSON.parse(fs.readFileSync(tempOutputJson, "utf8"));
  } else if (stderr) {
    console.warn("stderr:", stderr);
  }
}

async function executeExternalSession(command, args, hostChannel, action) {
  const child = spawn(command, args);
  child.stdout.setEncoding('utf8');
  const clientChannel = `${Math.random()}#client`;
  
  const promise = new Promise(resolve => {
    child.stdout.on('data', function (data) {
      console.log('stdout: ' + data);
      resolve();
    });
  });
  await promise;

  child.stderr.setEncoding('utf8');
  child.stderr.on('data', function (data) {
    //Here is where the error output goes

    console.log('stderr: ' + data);

    data = data.toString();
  });

  child.on('close', function (code) {
    //Here you can get the exit code of the script

    console.log('closing code: ' + code);

  });

  const c = new Client();
  c.start();

  return {
    terminate: () => kill(child.pid),
    getDataFromHost: async () => {
      const promise = new Promise(resolve => {
        c.on(clientChannel, (data) => {
          resolve(data);
        });
      });
      return await promise;
    },
    writeDataToHost: (data) => c.write(hostChannel, { data, clientChannel, action })
  }
}

exports.createFolderIfNotExist = createFolderIfNotExist;
exports.executeExternalHelper = executeExternalHelper;
exports.executeExternalSession = executeExternalSession;

