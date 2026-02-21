/**
 * Web Speech API type declarations for browsers that prefix the API.
 * Chrome/Edge expose webkitSpeechRecognition; the standard SpeechRecognition
 * is available in Safari 14.1+. Firefox does not support the API.
 */

/* eslint-disable @typescript-eslint/no-empty-object-type */

interface BrewSpeechRecognitionAlternative {
  readonly transcript: string;
  readonly confidence: number;
}

interface BrewSpeechRecognitionResult {
  readonly isFinal: boolean;
  readonly length: number;
  item(index: number): BrewSpeechRecognitionAlternative;
  [index: number]: BrewSpeechRecognitionAlternative;
}

interface BrewSpeechRecognitionResultList {
  readonly length: number;
  item(index: number): BrewSpeechRecognitionResult;
  [index: number]: BrewSpeechRecognitionResult;
}

interface BrewSpeechRecognitionEvent extends Event {
  readonly resultIndex: number;
  readonly results: BrewSpeechRecognitionResultList;
}

interface BrewSpeechRecognitionErrorEvent extends Event {
  readonly error: string;
  readonly message: string;
}

interface BrewSpeechRecognition extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: BrewSpeechRecognitionEvent) => void) | null;
  onerror: ((event: BrewSpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

interface BrewSpeechRecognitionConstructor {
  new(): BrewSpeechRecognition;
  prototype: BrewSpeechRecognition;
}

interface Window {
  SpeechRecognition?: BrewSpeechRecognitionConstructor;
  webkitSpeechRecognition?: BrewSpeechRecognitionConstructor;
}
