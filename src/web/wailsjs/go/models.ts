export namespace main {
	
	export class AISettings {
	    baseUrl: string;
	    apiKey: string;
	    model: string;
	    approveCommands: boolean;
	    maxSteps: number;
	    instructions: string;
	    contextWindow: number;
	
	    static createFrom(source: any = {}) {
	        return new AISettings(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.baseUrl = source["baseUrl"];
	        this.apiKey = source["apiKey"];
	        this.model = source["model"];
	        this.approveCommands = source["approveCommands"];
	        this.maxSteps = source["maxSteps"];
	        this.instructions = source["instructions"];
	        this.contextWindow = source["contextWindow"];
	    }
	}
	export class AppInfo {
	    version: string;
	    dataDir: string;
	    logPath: string;
	    platform: string;
	
	    static createFrom(source: any = {}) {
	        return new AppInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.version = source["version"];
	        this.dataDir = source["dataDir"];
	        this.logPath = source["logPath"];
	        this.platform = source["platform"];
	    }
	}
	export class ChatLogEntry {
	    kind: string;
	    content: string;
	    callId?: string;
	    name?: string;
	    args?: string;
	    status?: string;
	    result?: string;
	    ts: number;
	
	    static createFrom(source: any = {}) {
	        return new ChatLogEntry(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.kind = source["kind"];
	        this.content = source["content"];
	        this.callId = source["callId"];
	        this.name = source["name"];
	        this.args = source["args"];
	        this.status = source["status"];
	        this.result = source["result"];
	        this.ts = source["ts"];
	    }
	}
	export class ChatUsage {
	    promptTokens: number;
	    completionTokens: number;
	    totalTokens: number;
	    lastPromptTokens: number;
	
	    static createFrom(source: any = {}) {
	        return new ChatUsage(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.promptTokens = source["promptTokens"];
	        this.completionTokens = source["completionTokens"];
	        this.totalTokens = source["totalTokens"];
	        this.lastPromptTokens = source["lastPromptTokens"];
	    }
	}
	export class ChatDetail {
	    id: string;
	    title: string;
	    group: string;
	    hostId: string;
	    archived: boolean;
	    createdAt: number;
	    updatedAt: number;
	    usage: ChatUsage;
	    busy: boolean;
	    log: ChatLogEntry[];
	    truncated: boolean;
	
	    static createFrom(source: any = {}) {
	        return new ChatDetail(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.title = source["title"];
	        this.group = source["group"];
	        this.hostId = source["hostId"];
	        this.archived = source["archived"];
	        this.createdAt = source["createdAt"];
	        this.updatedAt = source["updatedAt"];
	        this.usage = this.convertValues(source["usage"], ChatUsage);
	        this.busy = source["busy"];
	        this.log = this.convertValues(source["log"], ChatLogEntry);
	        this.truncated = source["truncated"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	export class ChatSummary {
	    id: string;
	    title: string;
	    group: string;
	    hostId: string;
	    archived: boolean;
	    createdAt: number;
	    updatedAt: number;
	    usage: ChatUsage;
	    busy: boolean;
	
	    static createFrom(source: any = {}) {
	        return new ChatSummary(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.title = source["title"];
	        this.group = source["group"];
	        this.hostId = source["hostId"];
	        this.archived = source["archived"];
	        this.createdAt = source["createdAt"];
	        this.updatedAt = source["updatedAt"];
	        this.usage = this.convertValues(source["usage"], ChatUsage);
	        this.busy = source["busy"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	export class Host {
	    id: string;
	    name: string;
	    group: string;
	    address: string;
	    port: number;
	    user: string;
	    authMethod: string;
	    keyPath: string;
	    keyPassphrase: string;
	    password: string;
	    color: string;
	    notes: string;
	
	    static createFrom(source: any = {}) {
	        return new Host(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.group = source["group"];
	        this.address = source["address"];
	        this.port = source["port"];
	        this.user = source["user"];
	        this.authMethod = source["authMethod"];
	        this.keyPath = source["keyPath"];
	        this.keyPassphrase = source["keyPassphrase"];
	        this.password = source["password"];
	        this.color = source["color"];
	        this.notes = source["notes"];
	    }
	}
	export class KeyInfo {
	    path: string;
	    type: string;
	    fingerprint: string;
	    comment: string;
	    encrypted: boolean;
	    source: string;
	
	    static createFrom(source: any = {}) {
	        return new KeyInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.type = source["type"];
	        this.fingerprint = source["fingerprint"];
	        this.comment = source["comment"];
	        this.encrypted = source["encrypted"];
	        this.source = source["source"];
	    }
	}
	export class SessionInfo {
	    id: string;
	    hostId: string;
	    title: string;
	    connected: boolean;
	    user: string;
	    address: string;
	    color: string;
	
	    static createFrom(source: any = {}) {
	        return new SessionInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.hostId = source["hostId"];
	        this.title = source["title"];
	        this.connected = source["connected"];
	        this.user = source["user"];
	        this.address = source["address"];
	        this.color = source["color"];
	    }
	}
	export class Settings {
	    themeId: string;
	    language: string;
	    fontFamily: string;
	    fontSize: number;
	    fontWeight: number;
	    fontWeightBold: number;
	    letterSpacing: number;
	    lineHeight: number;
	    cursorStyle: string;
	    cursorBlink: boolean;
	    scrollback: number;
	    copyOnSelect: boolean;
	    rightClickPaste: boolean;
	    uiScale: number;
	    sidebarWidth: number;
	    agentWidth: number;
	    sidebarVisible: boolean;
	    agentVisible: boolean;
	    agentSide: string;
	    reduceMotion: boolean;
	    ai: AISettings;
	
	    static createFrom(source: any = {}) {
	        return new Settings(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.themeId = source["themeId"];
	        this.language = source["language"];
	        this.fontFamily = source["fontFamily"];
	        this.fontSize = source["fontSize"];
	        this.fontWeight = source["fontWeight"];
	        this.fontWeightBold = source["fontWeightBold"];
	        this.letterSpacing = source["letterSpacing"];
	        this.lineHeight = source["lineHeight"];
	        this.cursorStyle = source["cursorStyle"];
	        this.cursorBlink = source["cursorBlink"];
	        this.scrollback = source["scrollback"];
	        this.copyOnSelect = source["copyOnSelect"];
	        this.rightClickPaste = source["rightClickPaste"];
	        this.uiScale = source["uiScale"];
	        this.sidebarWidth = source["sidebarWidth"];
	        this.agentWidth = source["agentWidth"];
	        this.sidebarVisible = source["sidebarVisible"];
	        this.agentVisible = source["agentVisible"];
	        this.agentSide = source["agentSide"];
	        this.reduceMotion = source["reduceMotion"];
	        this.ai = this.convertValues(source["ai"], AISettings);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

