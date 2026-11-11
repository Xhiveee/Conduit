export namespace main {
	
	export class AISettings {
	    baseUrl: string;
	    apiKey: string;
	    model: string;
	    approveCommands: boolean;
	    maxSteps: number;
	    instructions: string;
	
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
	export class Theme {
	    id: string;
	    name: string;
	    builtin: boolean;
	    ui: Record<string, string>;
	    terminal: Record<string, string>;
	
	    static createFrom(source: any = {}) {
	        return new Theme(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.builtin = source["builtin"];
	        this.ui = source["ui"];
	        this.terminal = source["terminal"];
	    }
	}
	export class Settings {
	    themeId: string;
	    customThemes: Theme[];
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
	    customCss: string;
	    ai: AISettings;
	
	    static createFrom(source: any = {}) {
	        return new Settings(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.themeId = source["themeId"];
	        this.customThemes = this.convertValues(source["customThemes"], Theme);
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
	        this.customCss = source["customCss"];
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

