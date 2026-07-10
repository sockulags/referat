// All user-facing UI copy, centralized (Swedish now, prepares for i18n later).
// Tone: warm klarspråk — plain, friendly, no jargon. See docs/produkt.md.

export const strings = {
  app: {
    name: 'referat',
    tagline: 'Mötesanteckningar som stannar hos dig.'
  },

  common: {
    save: 'Spara',
    saved: 'Sparat',
    cancel: 'Avbryt',
    close: 'Stäng',
    delete: 'Ta bort',
    rename: 'Byt namn',
    open: 'Öppna',
    back: 'Tillbaka',
    next: 'Nästa',
    skip: 'Hoppa över',
    done: 'Klart',
    retry: 'Försök igen',
    showDetails: 'Visa detaljer',
    hideDetails: 'Dölj detaljer',
    optional: 'valfritt',
    loading: 'Laddar…',
    settings: 'Inställningar'
  },

  topbar: {
    settings: 'Inställningar',
    openSettings: 'Öppna inställningar',
    backHome: 'Till startsidan'
  },

  home: {
    heroKicker: 'Redo när du är det',
    startRecording: 'Starta inspelning',
    titlePlaceholder: 'Ge mötet en titel (valfritt)',
    previousMeetings: 'Tidigare möten',
    emptyTitle: 'Ditt första möte väntar',
    emptyBody:
      'När du spelar in ett möte dyker det upp här — med protokoll, beslut och actionpunkter färdiga att dela.',
    emptyCta: 'Starta ditt första möte',
    openMeeting: 'Öppna möte',
    renameMeeting: 'Byt namn',
    deleteMeeting: 'Ta bort möte'
  },

  status: {
    recording: 'Spelar in',
    recorded: 'Inspelad',
    transcribing: 'Transkriberar',
    summarizing: 'Sammanfattar',
    done: 'Klar',
    error: 'Fel'
  },

  recording: {
    title: 'Inspelning pågår',
    untitled: 'Möte utan titel',
    micLabel: 'Mikrofon',
    systemLabel: 'Systemljud',
    pause: 'Pausa',
    resume: 'Återuppta',
    paused: 'Pausad',
    stop: 'Stoppa och spara',
    cancel: 'Avbryt inspelning',
    cancelTitle: 'Avbryt inspelningen?',
    cancelBody: 'Ljudet slängs och inget protokoll skapas. Det går inte att ångra.',
    cancelConfirm: 'Ja, avbryt',
    cancelKeep: 'Nej, fortsätt spela in',
    systemAudioMissing: 'Systemljud kunde inte fångas — mötet spelas in via mikrofonen.',
    micDeniedTitle: 'Vi kommer inte åt mikrofonen',
    micDeniedBody:
      'referat behöver tillgång till mikrofonen för att spela in. Tillåt mikrofon i Windows sekretessinställningar och försök igen.',
    starting: 'Startar inspelning…',
    elapsed: 'Inspelad tid'
  },

  meeting: {
    tabProtocol: 'Protokoll',
    tabTranscript: 'Transkript',
    renameHint: 'Klicka för att byta namn',
    protocolEmpty: 'Protokollet är inte klart än.',
    transcriptEmpty: 'Transkriptet är inte klart än.',
    searchTranscript: 'Sök i transkriptet',
    noMatches: 'Inga träffar',
    copy: 'Kopiera',
    copied: 'Kopierat!',
    saveMarkdown: 'Spara som Markdown',
    saveWord: 'Spara som Word',
    exported: 'Sparad',
    export: 'Exportera',
    pipelineTitle: 'Skapar ditt protokoll',
    pipelineBody: 'Du kan stänga appen — arbetet fortsätter och återupptas nästa gång.',
    errorTitle: 'Något gick fel',
    steps: {
      recorded: 'Inspelad',
      transcribing: 'Transkriberar',
      summarizing: 'Sammanfattar',
      done: 'Klart'
    }
  },

  onboarding: {
    step: 'Steg',
    of: 'av',
    welcome: {
      title: 'Välkommen till referat',
      body: 'referat spelar in dina möten, skriver ut vad som sagts och skapar ett färdigt protokoll med sammanfattning, beslut och actionpunkter. Du bestämmer själv var AI:n kör — allt kan stanna på din dator.',
      cta: 'Kom igång'
    },
    provider: {
      title: 'Var ska AI:n köra?',
      body: 'Det här avgör vart ditt ljud och din text tar vägen. Du kan ändra det när som helst i inställningarna.',
      local: {
        title: 'På den här datorn',
        body: 'Inget lämnar din dator. Kräver en lokal AI-server — vi hjälper dig igång.'
      },
      server: {
        title: 'På företagets server',
        body: 'Din IT-avdelning ger dig en adress och eventuellt en nyckel.'
      },
      cloud: {
        title: 'Molntjänst',
        body: 'Använd OpenAI eller Azure OpenAI. Du anger din API-nyckel.'
      },
      serverAddress: 'Serveradress',
      serverAddressHint: 'Adressen du fått av IT, t.ex. https://ai.företaget.se/v1',
      apiKey: 'API-nyckel',
      apiKeyHint: 'Klistras in en gång och sparas krypterat på din dator.'
    },
    test: {
      title: 'Vi provar anslutningen',
      body: 'Vi kollar att referat når AI:n för både transkribering och sammanfattning.',
      run: 'Testa anslutningen',
      testing: 'Testar…',
      transcription: 'Transkribering',
      summary: 'Sammanfattning',
      allGood: 'Allt fungerar!',
      someFailed: 'En anslutning svarar inte',
      continueAnyway: 'Fortsätt ändå'
    },
    mic: {
      title: 'Testa mikrofonen',
      body: 'Säg något — stapeln nedan ska röra sig. Välj en annan mikrofon om det behövs.',
      device: 'Mikrofon',
      speakNow: 'Säg något så ser du mätaren röra sig',
      looksGood: 'Mikrofonen fungerar',
      finish: 'Klar — sätt igång'
    }
  },

  settings: {
    title: 'Inställningar',
    audio: {
      title: 'Ljud',
      description: 'Vilken mikrofon som används och om systemljudet spelas in.',
      microphone: 'Mikrofon',
      systemAudio: 'Spela in systemljud',
      systemAudioHint: 'Fånga det som spelas upp i datorn, t.ex. andra i ett videomöte.'
    },
    transcription: {
      title: 'Transkribering',
      description: 'Tjänsten som skriver ut vad som sagts under mötet.',
      preset: 'Förval',
      baseUrl: 'Bas-URL',
      model: 'Modell',
      language: 'Språk',
      languageHint: 'Lämna tomt för automatisk igenkänning, eller ange t.ex. sv.'
    },
    summary: {
      title: 'Sammanfattning',
      description: 'Tjänsten som skapar själva protokollet från transkriptet.',
      flavor: 'Gränssnitt',
      advanced: 'Avancerat: protokollmall',
      promptTemplate: 'Protokollmall',
      promptHint: 'Instruktionen som styr protokollet. {{transcript}} byts mot transkriptet.'
    },
    appearance: {
      title: 'Utseende',
      description: 'Ljust eller mörkt tema.',
      theme: 'Tema',
      system: 'Följ systemet',
      light: 'Ljust',
      dark: 'Mörkt'
    },
    apiKey: 'API-nyckel',
    apiKeySavedPlaceholder: '••••••• (sparad)',
    apiKeyNewPlaceholder: 'Klistra in nyckel',
    apiKeyHint: 'Sparas krypterat och lämnar aldrig din dator i klartext.',
    testConnection: 'Testa anslutning',
    testing: 'Testar…',
    testOk: 'Anslutningen fungerar',
    rerunOnboarding: 'Kör introduktionen igen',
    version: 'Version',
    presets: {
      local: 'Lokal server',
      openai: 'OpenAI',
      azure: 'Azure OpenAI',
      anthropic: 'Anthropic',
      custom: 'Egen endpoint'
    }
  },

  errors: {
    genericTitle: 'Något gick fel',
    loadMeetings: 'Vi kunde inte läsa dina möten just nu.',
    loadMeeting: 'Vi kunde inte öppna mötet.'
  }
} as const
