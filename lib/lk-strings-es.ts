import type { LkStringsOverride } from "@intellectif/lk-react/i18n/LkIntlProvider";

// Spanish for the learning-kit components the platform shows: the interactive video, the question types it can
// hold, the AI help and the media controls. lk-react ships English only; anything not listed here (read-aloud and
// pronunciation, which no lesson uses yet) falls back to English.
export const LK_STRINGS_ES: LkStringsOverride = {
  submit: "Enviar",
  checkAnswers: "Comprobar respuestas",
  submitAnswers: "Enviar respuestas",
  scoreAnnouncement: (percent, passed) => `Puntuación ${percent} %. ${passed ? "Aprobado." : "No aprobado."}`,
  answerSubmitted: "Respuesta enviada.",
  notGradedYet: "Todavía sin calificar.",
  noGradeAvailable: "No hay calificación disponible.",

  tryAgain: "Intentar de nuevo",
  showAnswer: "Ver la respuesta",
  keepAnswer: "Quedarme con esta respuesta",
  triesLeft: (tries, costPercent) =>
    `Te ${tries === 1 ? "queda 1 intento" : `quedan ${tries} intentos`}.${costPercent > 0 ? ` Cada uno cuesta un ${costPercent} % de la nota.` : ""}`,
  countedTry: (counts, percent) =>
    `Cuenta tu ${counts === "first" ? "primer" : "mejor"} intento. Este obtuvo un ${percent} %.`,
  scoreBeforeCosts: (percent) => `Antes de pistas e intentos, esta respuesta obtuvo un ${percent} %.`,
  hintCost: (percent) => `Cada pista cuesta un ${percent} % de la nota de esta pregunta.`,

  showFeedback: "Ver comentarios",
  hideFeedback: "Ocultar comentarios",
  blankLabel: (ordinal) => `Completa el espacio ${ordinal}`,
  gapLabel: (ordinal) => `Elige la respuesta del espacio ${ordinal}`,
  gapPlaceholder: "Elige…",
  showHint: "Ver pista",
  hideHint: "Ocultar pista",

  responseSubmitted: "Respuesta enviada. Se calificará y tu resultado aparecerá aquí más tarde.",
  wordCount: (count) => `${count} ${count === 1 ? "palabra" : "palabras"}`,
  wordBounds: (min, max) => (min > 0 ? `${min}–${max} palabras` : `hasta ${max} palabras`),
  notApplicable: "No aplica",
  awaitingHumanReview: "Esta calificación está pendiente de revisión por un docente.",
  awaitingGrade: "Todavía sin calificar. Esta respuesta está esperando su nota.",
  couldNotBeGraded: "No se pudo calificar esta respuesta.",

  previous: "Anterior",
  next: "Siguiente",
  questionProgress: (index, total) => `Pregunta ${index} de ${total}`,
  unsupportedActivity: "Este tipo de actividad no se puede mostrar.",

  dictationInputLabel: "Escribe lo que oyes",
  dictationRecording: "Grabación",
  dictationSlowRecording: "Grabación lenta",
  dictationRevealNextWord: (revealed, total) => `Mostrar la siguiente palabra (${revealed} de ${total})`,
  dictationResetHints: "Reiniciar pistas",
  showSolution: "Ver la solución",
  hideSolution: "Ocultar la solución",
  dictationSolutionLabel: "Solución",
  dictationMarksLabel: "Tu respuesta, palabra por palabra",
  dictationDiffNote: "Se compara sin tener en cuenta mayúsculas, puntuación ni espacios de más.",
  dictationWordCorrect: (word) => `«${word}» es correcta`,
  dictationWordWrong: (word, expected) => `«${word}» debería ser «${expected}»`,
  dictationWordMissing: (expected) => `Falta «${expected}»`,
  dictationWordWrongUnnamed: (word) => `«${word}» es incorrecta`,
  dictationWordMissingUnnamed: "Falta una palabra",
  dictationWordExtra: (word) => `«${word}» sobra`,
  dictationLegendCorrect: "Correcta",
  dictationLegendWrong: "Incorrecta",
  dictationLegendMissing: "Falta",
  dictationLegendExtra: "Sobra",
  dictationNothingTyped: "No hay nada que comparar: no escribiste ninguna palabra.",
  dictationWordsSummary: (correct, total) => `${correct} de ${total} ${total === 1 ? "palabra correcta" : "palabras correctas"}.`,

  videoBack: (seconds) => `Retroceder ${seconds} segundos`,
  videoForward: (seconds) => `Avanzar ${seconds} segundos`,
  videoReplay: "Volver a ver",
  videoShowRemaining: "Mostrar el tiempo restante",
  videoShowElapsed: "Mostrar el tiempo transcurrido",
  videoCaptionsShow: "Mostrar subtítulos",
  videoCaptionsHide: "Ocultar subtítulos",
  videoCaptionsFailed: "No se pudieron cargar los subtítulos.",
  videoSecondaryCaptionsFailed: "No se pudo cargar el segundo idioma.",
  videoSpeedValue: (rate) => (rate === 1 ? "Normal" : `${rate}×`),
  videoSettings: "Ajustes",
  videoCaptionLanguage: "Subtítulos",
  videoSecondCaptionLanguage: "Segundo idioma",
  videoCaptionPair: (primary, secondary) => `${primary} + ${secondary}`,
  videoNoSecondLanguage: "Este video no tiene un segundo idioma.",
  videoCaptionSize: "Tamaño de los subtítulos",
  videoCaptionSizeValue: (size) => (size === "small" ? "Pequeño" : size === "large" ? "Grande" : "Mediano"),
  videoCaptionBackground: "Fondo de los subtítulos",
  videoKeyboardShortcuts: "Atajos de teclado",
  videoShortcutList: "Lista de atajos",
  videoClose: "Cerrar",
  videoOn: "Sí",
  videoOff: "No",
  videoShortcut: (action) => {
    switch (action) {
      case "play-pause":
        return "Reproducir o pausar";
      case "jump-10":
        return "Retroceder o avanzar 10 segundos";
      case "jump-5":
        return "Retroceder o avanzar 5 segundos";
      case "jump-1":
        return "Retroceder o avanzar 1 segundo";
      case "frame":
        return "Fotograma anterior o siguiente, en pausa";
      case "speed":
        return "Más lento o más rápido";
      case "percent":
        return "Ir al 0 % – 90 %";
      case "start-end":
        return "Inicio o final";
      case "chapter":
        return "Capítulo o cuestionario anterior o siguiente";
      case "mute":
        return "Silenciar";
      case "captions":
        return "Subtítulos";
      case "secondary-captions":
        return "Segundo idioma de subtítulos sí/no";
      case "transcript":
        return "Transcripción";
      case "picture-in-picture":
        return "Imagen en imagen";
      case "fullscreen":
        return "Pantalla completa";
      default:
        return "Esta lista";
    }
  },
  videoPanel: "Contenido y transcripción",
  videoContents: "Contenido",
  videoTranscript: "Transcripción",
  videoTranscriptSearch: "Buscar en la transcripción",
  videoTranscriptNoMatch: "Ninguna línea coincide.",
  videoPictureInPicture: "Imagen en imagen",
  videoFullscreen: "Pantalla completa",
  videoExitFullscreen: "Salir de pantalla completa",
  videoError: (code) =>
    code === 2
      ? "Se perdió la conexión mientras cargaba el video."
      : code === 3
        ? "No se pudo reproducir este archivo de video."
        : code === 4
          ? "No se pudo cargar el video."
          : "El video se detuvo antes de poder reproducirse.",
  videoTryAgain: "Intentar de nuevo",
  videoQuiz: "Cuestionario",
  videoQuestionProgress: (index, total) => `Pregunta ${index} de ${total}`,
  videoQuestionStep: (index, answered) => `Pregunta ${index}${answered ? ", respondida" : ""}`,
  videoNextQuestion: "Siguiente pregunta",
  videoContinue: "Seguir con el video",
  videoSkipQuiz: "Saltar cuestionario",
  videoRewatch: "Volver a ver",
  videoAnswerSaved: "Respuesta guardada",
  videoAnswerPending: "Guardando tu respuesta…",
  videoRequired: "Obligatorio",
  videoQuizProgress: (answered, total) =>
    answered === total ? "Respondido" : answered === 0 ? "Sin empezar" : `${answered} de ${total} respondidas`,
  videoQuizOpened: (time, questions) =>
    `Video en pausa. Cuestionario en ${time}, ${questions} ${questions === 1 ? "pregunta" : "preguntas"}.`,
  videoHeldAtQuiz: (time) => `Termina el cuestionario de ${time} para continuar.`,
  videoHeldAhead: "Puedes retroceder, pero no adelantar.",
  videoEnded: "Llegaste al final",
  videoEndScore: (answered, total, percent) => `Respondiste ${answered} de ${total} · ${percent} %`,
  videoEndAnswered: (answered, total) => `Respondiste ${answered} de ${total} preguntas`,
  videoWatchAgain: "Ver de nuevo",
  videoFinish: "Terminar",

  embeddedMedia: "Contenido incrustado",
  stimulusKind: { text: "Texto", audio: "Grabación", video: "Video", image: "Imagen", mixed: "Material" },
  stimulusRange: (first, last) => (first === last ? `Pregunta ${first}` : `Preguntas ${first}–${last}`),

  activityFailed: "No se pudo mostrar la actividad",
  activityFailedNamed: (title) => `No se pudo mostrar «${title}».`,
  activityFailedUnnamed: "No se pudo mostrar esta actividad.",
  aiExplain: "Explícame mi respuesta",
  aiExplaining: "Explicando…",
  aiExplanation: "Explicación",
  aiExplanationUnavailable: "Ahora mismo no hay una explicación disponible.",
  aiHint: "Dame una pista",
  aiHintLoading: "Buscando una pista…",
  aiHintNumber: (hintNumber) => `Pista ${hintNumber}`,
  aiHints: "Pistas",
  aiHintUnavailable: "Ahora mismo no hay una pista disponible.",
  aiNoMoreHints: "No hay más pistas para esta pregunta.",
  aiNotice: "Escrito por IA. Puede equivocarse.",

  media: {
    play: "Reproducir",
    pause: "Pausar",
    preparing: "Preparando…",
    mute: "Silenciar",
    unmute: "Activar sonido",
    volume: "Volumen",
    speed: "Velocidad de reproducción",
    seek: "Buscar",
    timeValue: (elapsed, duration) => `${elapsed} de ${duration}`,
    playsRemaining: (remaining, max) => `Te ${remaining === 1 ? "queda" : "quedan"} ${remaining} de ${max} ${max === 1 ? "reproducción" : "reproducciones"}`,
    noPlaysRemaining: "No te quedan reproducciones",
    lastPlayConfirm: "Es tu última reproducción. ¿Empezar ahora?",
    lastPlayStart: "Empezar la última",
    lastPlayCancel: "Todavía no",
    seekBlocked: "Esta grabación no se puede retroceder.",
    rateBlocked: "La velocidad de esta grabación es fija.",
    playFailed: "No se pudo iniciar la grabación. Inténtalo de nuevo.",
  },
};
