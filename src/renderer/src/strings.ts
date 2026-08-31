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
    summaryTemplate: 'Sammanfattning',
    summaryTemplateHint:
      'Styr vad protokollet blir när mötet är slut. Du kan skapa fler sammanfattningar efteråt.',
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
    diarizing: 'Identifierar talare',
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
    summariesAllDeleted:
      'Du har tagit bort alla sammanfattningar av det här mötet. Transkriptet finns kvar — skapa en ny sammanfattning från valfri mall.',
    deleteSummary: 'Ta bort',
    deleteSummaryTitle: 'Ta bort sammanfattningen?',
    deleteSummaryBody: (name: string): string =>
      `Sammanfattningen "${name}" och dess fil tas bort. Transkriptet och mötets övriga sammanfattningar påverkas inte. Det går inte att ångra.`,
    newSummary: 'Ny sammanfattning',
    newSummaryTitle: 'Ny sammanfattning',
    newSummaryIntro:
      'Samma möte, en annan mall och en annan mottagare. Den nya sammanfattningen läggs till — de du redan har står kvar.',
    newSummaryTemplate: 'Mall',
    newSummaryFocus: 'Fokus (valfritt)',
    newSummaryFocusPlaceholder: 'T.ex. bara upphandlingen av nytt ärendesystem',
    newSummaryFocusHint:
      'Ett långt möte hinner med flera saker. Skriv vad den här sammanfattningen ska handla om, så utelämnas resten. Lämna tomt för hela mötet.',
    newSummaryCreate: 'Skapa sammanfattning',
    summaryGenerating: 'Skapar sammanfattningen…',
    summaryFocusLabel: (focus: string): string => `Fokus: ${focus}`,
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
    warningTitle: 'Protokollet är klart — med en notis',
    speakerRenameHint: 'Klicka för att byta namn på talaren',
    speakerNamePlaceholder: 'Namn, t.ex. Anna',
    speakerSuggestionHint: 'Föreslaget namn utifrån rösten — klicka för att bekräfta eller ändra',
    speakerSuggestionDismiss: 'Nej, ta bort förslaget',
    speakersChangedHint:
      'Du har ändrat talarnamn. Skapa protokollet igen så används de nya namnen.',
    updateProtocol: 'Uppdatera protokollet',
    updateSummaries: 'Uppdatera sammanfattningarna',
    addToGlossary: 'Lägg till i ordlistan',
    glossaryTitle: 'Lägg till i ordlistan',
    glossaryIntro:
      'Transkriberingen hör ofta fel på tekniska ord och namn. Lägg till det som hördes och vad det ska vara, så rättas det här och i alla kommande möten.',
    glossaryHeard: 'Hördes som',
    glossaryCorrect: 'Ska vara',
    glossaryCorrectHint: 'Skrivs exakt så här i transkriptet och protokollet.',
    glossaryPickExisting: 'Eller välj en term du redan har',
    glossaryPickNew: 'Ny term',
    glossarySave: 'Spara i ordlistan',
    glossaryCorrectedTitle: 'Rättad från ordlistan',
    glossaryChangedHint: 'Transkriptet är rättat från ordlistan. Skapa protokollet igen.',
    glossaryNoChange: 'Termen sparades, men den förekommer inte i det här transkriptet.',
    steps: {
      recorded: 'Inspelad',
      transcribing: 'Transkriberar',
      diarizing: 'Identifierar talare',
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
        body: 'Referat installerar transkriberingen åt dig. Ljudet stannar på datorn.'
      },
      localGuide: 'Så installerar du en lokal AI-server',
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
      languageHint: 'Lämna tomt för automatisk igenkänning, eller ange t.ex. sv.',
      builtInTitle: 'Lokal CPU-transkribering',
      builtInDescription:
        'Referat installerar en svensk Whisper-modell och kör den lokalt. Ingen Docker, serveradress eller API-nyckel behövs.',
      builtInSize: 'Cirka 700 MB efter installation.'
    },
    summary: {
      title: 'Sammanfattning',
      description: 'Tjänsten som skapar själva protokollet från transkriptet.',
      flavor: 'API-typ',
      codexTitle: 'Använder din befintliga Codex-inloggning',
      codexDescription:
        'Referat kör den Codex CLI som redan finns på datorn. Codex kräver ingen API-nyckel och varje protokoll körs utan beständig Codex-historik.',
      testCodex: 'Testa Codex',
      advanced: 'Avancerat: mallar',
      templatesHint:
        'En mall är instruktionen som styr vad sammanfattningen blir. Du väljer mall när du startar ett möte, och kan skapa fler sammanfattningar av samma möte efteråt.',
      templatePick: 'Mall att ändra',
      templateName: 'Mallens namn',
      promptTemplate: 'Instruktion',
      promptHint:
        '{{transcript}} byts mot transkriptet, {{ordlista}} mot ordlistan och {{fokus}} mot det användaren vill att sammanfattningen ska handla om.',
      templateAdd: 'Ny mall',
      templateNewName: 'Egen mall',
      templateDelete: 'Ta bort mallen',
      templateBuiltIn: 'Inbyggd mall — går att ändra, men inte att ta bort.'
    },
    diarization: {
      title: 'Talare',
      description: 'Märker upp vem som säger vad i transkriptet, som "Talare 1" och "Talare 2".',
      userName: 'Ditt namn',
      userNameHint:
        'Används som ditt talarnamn i transkript och protokoll. Referat vet vilka delar som kom från din mikrofon, så namnet sätts åt dig — utan namn står det "Jag". Fungerar även utan talaridentifiering.',
      userNamePlaceholder: 'T.ex. Anna Svensson',
      enable: 'Identifiera talare',
      enableHint:
        'Kräver en lokal talarserver på din dator eller i nätverket — se guiden på webbplatsen. Namnen går att ändra i efterhand.',
      baseUrl: 'Serveradress',
      baseUrlHint:
        'Adressen till talarservern, t.ex. http://127.0.0.1:8300. Skriv IP-adressen hellre än localhost — servern lyssnar på 127.0.0.1, och localhost kan slå upp till IPv6 i stället.',
      backend: 'Kör talaridentifiering',
      builtIn: 'På den här datorn',
      server: 'Egen server',
      setupTitle: 'Installera lokal talaridentifiering',
      setupDescription:
        'Talarmodellen följer med komponenten, så inget konto och ingen nyckel behövs. Välj CPU eller Nvidia-GPU och installera. Modellen kommer från pyannote och används under CC-BY-4.0.',
      cpuTitle: 'CPU',
      cpuDescription: 'Fungerar utan Nvidia-GPU men kan ta lång tid för ett helt möte.',
      gpuTitle: 'Nvidia GPU',
      gpuDescription: 'Rekommenderas för långa möten. Komponenten kräver flera GB diskutrymme.',
      recognition: {
        enable: 'Känn igen talare mellan möten',
        enableHint:
          'När du namnger en talare sparas ett röstavtryck på din dator, och nästa gång rösten hörs föreslås namnet med ett frågetecken — du bekräftar alltid själv. Har du fyllt i ditt namn ovan sparas även din egen röst automatiskt, eftersom appen vet vilken talare som är du. Röstavtryck räknas som biometriska uppgifter: berätta för mötesdeltagarna och ta bort avtryck på begäran.',
        profilesTitle: 'Sparade röster',
        profilesEmpty:
          'Inga sparade röster än. Namnge en talare i ett transkript så sparas rösten här.',
        profileMeetings: 'möten',
        forget: 'Glöm rösten',
        forgetAll: 'Glöm alla röster',
        forgetAllConfirmTitle: 'Glöm alla röster?',
        forgetAllConfirmBody:
          'Alla sparade röstavtryck tas bort. Namn som redan står i transkript påverkas inte. Det går inte att ångra.',
        forgetAllConfirm: 'Ja, glöm alla'
      }
    },
    glossary: {
      title: 'Ordlista',
      description:
        'Termer som transkriberingen hör fel på. Varje term kan ha flera varianter — samma ord blir olika beroende på vem som talar. Listan gäller alla möten.',
      empty:
        'Ordlistan är tom. Markera ett felhört ord i ett transkript och välj "Lägg till i ordlistan".',
      canonical: 'Korrekt stavning',
      variants: 'Hördes som',
      variantsHint: 'En variant per rad.',
      variantCount: (n: number): string => (n === 1 ? '1 variant' : `${n} varianter`),
      delete: 'Ta bort termen',
      deleteConfirmTitle: 'Ta bort termen?',
      deleteConfirmBody:
        'Termen tas bort ur ordlistan. Transkript som redan rättats behåller rättningen tills protokollet skapas om.',
      deleteConfirm: 'Ja, ta bort'
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
      'built-in': 'Inbyggd lokal modell',
      local: 'Lokal server',
      openai: 'OpenAI',
      azure: 'Azure OpenAI',
      anthropic: 'Anthropic',
      codex: 'Codex CLI',
      custom: 'Egen adress'
    }
  },

  update: {
    ready: 'En ny version är redo — installeras när du stänger appen.',
    restartNow: 'Starta om nu'
  },

  errors: {
    genericTitle: 'Något gick fel',
    loadMeetings: 'Vi kunde inte läsa dina möten just nu.',
    loadMeeting: 'Vi kunde inte öppna mötet.'
  }
} as const
