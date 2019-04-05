const bfs = require("browserfs");
const JSZip = require("jszip");
const git = require("isomorphic-git");

const Buffer = bfs.BFSRequire("buffer").Buffer;
const path = bfs.BFSRequire("path");

const REPO_PREFIX = "repo";

class GitZipVFS {
    constructor (data) {
        if (data) {
            this.load(data);
        } else {
            const empty = new JSZip();
            empty.file(`${REPO_PREFIX}/placeholder`, "");
            empty.generateAsync({
                compression: "STORE",
                type: "arraybuffer",
            })
            .then(file => this.load(file))
            .then(() => this.__fs.unlinkSync(`${REPO_PREFIX}/placeholder`))
            .then(() => this.__git.init({ dir: REPO_PREFIX }))
            .then(() => this.__git.commit({
                dir: REPO_PREFIX,
                message: "initial commit",
                author: { name: "System", email: "system@example.com" },
            }));
        }

        this.__decorate();
    }

    // gzfs.load(fs.readFileSync("some.zip"))
    load (data) {
        return new Promise((resolve, reject) => {
            try {
                const zipData = Buffer.from(data);
                bfs.configure({
                    fs: "OverlayFS",
                    options: {
                        readable: {
                            fs: "ZipFS",
                            options: {
                                zipData,
                            },
                        },
                        writable: {
                            fs: "InMemory",
                        },
                    }
                }, (e) => {
                    if (e) {
                        console.error(e);
                        reject(e);
                        return;
                    }
                    this.__fs = bfs.BFSRequire("fs");
                    git.plugins.set("fs", this.__fs);
                    this.__git = git;
                    resolve();
                });
            } catch (e) {
                console.error(e);
                reject(e);
            }
        });
        
    }

    // gzfs.save().then(out => fs.writeFileSync("some.zip", out))
    save () {
        return new Promise((resolve, reject) => {
            const output = new JSZip();

            const addFile = (name) => {
                output.file(name, this.__fs.readFileSync(name));
                // TODO: metadata
            }

            const addFolder = (folder) => {
                this.__fs.readdirSync(folder).forEach((file) => {
                    const fullpath = path.join(folder, file);
                    if (this.__fs.statSync(fullpath).isDirectory()) {
                        addFolder(fullpath);
                    } else {
                        addFile(fullpath);
                    }
                });
            }

            try {
                addFolder(REPO_PREFIX);

                output.generateAsync({
                    compression: "DEFLATE",
                    compressionOptions: {
                        level: 9,
                    },
                    type: "arraybuffer",
                    platform: "UNIX"
                })
                .then(file => resolve(Buffer.from(file)));
            } catch (e) {
                reject(e);
            }
        });
    }

    __decorate () {
        const wrappers = {
            fs: (command) => (path, ...args) => {
                let cb = args[args.length - 1];
                if (cb && !(typeof cb === "function")) {
                    cb = undefined;
                }
                return new Promise((resolve, reject) =>
                    this.__fs[command](
                        (path && `${REPO_PREFIX}/${path}`) || REPO_PREFIX,
                        ...args,
                        (err, result) => {
                            if (err) {
                                reject(err);
                            } else {
                                resolve(result);
                            }
                            cb && cb(err, result);
                        }
                    )
                );
            },
            git: (command) => (opts = {}) =>
                this.__git[command](Object.assign({}, opts, { dir: REPO_PREFIX })),
        }

        for (const type in COMMANDS) {
            this[type] = {};

            for (const group in COMMANDS[type]) {
                if (typeof COMMANDS[type][group] === "string") {
                    const method = group;
                    const command = COMMANDS[type][method];
                    this[type][method] = wrappers[type](command);
                } else {
                    this[type][group] = {};
            
                    for (const method in COMMANDS[type][group]) {
                        const command = COMMANDS[type][group][method];
                        this[type][group][method] = wrappers[type](command);
                    }
                }
            }
        }
    }
}

const COMMANDS = {
    fs: {
        file: {
            exists: "exists",
            move: "rename",
            read: "readFile",
            remove: "unlink",
            write: "writeFile",
        },
        dir: {
            add: "mkdir",
            list: "readdir",
            remove: "rmdir",
        }
    },
    git: {
        file: {
            add: "add",
            list: "listFiles",
            remove: "remove",
            reset: "resetIndex",
            status: "status",
        },
        branch: {
            add: "branch",
            current: "currentBranch",
            list: "listBranches",
            remove: "deleteBranch",
        },
        tag: {
            add: "tag",
            annotate: "annotatedTag",
            list: "listTags",
            remove: "deleteTag",
        },
        checkout: "checkout",
        commit: "commit",
        log: "log",
        merge: "merge",
        status: "statusMatrix",
    
        // Unsupported:
        // remote: {
        //     add: "addRemote",
        //     info: "getRemoteInfo",
        //     list: "listRemotes",
        //     remove: "deleteRemote",
        // },
        // info: "info",
        // clone: "clone",
        // fetch: "fetch",
        // push: "push",
        // pull: "pull",
    },
};

module.exports = GitZipVFS;
