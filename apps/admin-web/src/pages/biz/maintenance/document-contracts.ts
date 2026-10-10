/** Persisted document contracts for the future maintenance document API. */
export type MaintenanceSubject = 'personnel' | 'vehicle' | 'generator';
export type DocumentStatus = 'uploaded' | 'queued' | 'recognizing' | 'needs_review' | 'confirmed' | 'failed';

export interface MaintenanceDocument {
  id: string;
  fileName: string;
  mimeType: string;
  byteSize: number;
  sha256: string;
  subjectKind: MaintenanceSubject;
  documentType: string;
  status: DocumentStatus;
  uploadedBy: string;
  uploadedAt: string;
  recognitionId: string | null;
}

export interface RecognitionResult {
  id: string;
  documentId: string;
  provider: string;
  rawText: string;
  fields: Array<{ key: string; value: string; confidence: number | null }>;
  candidates: Array<{ subjectKind: MaintenanceSubject; subjectId: string; reason: string }>;
  errorCode: string | null;
}

export interface DocumentConfirmation {
  documentId: string;
  links: Array<{ subjectKind: MaintenanceSubject; subjectId: string }>;
  correctedFields: Record<string, string>;
  validFrom: string | null;
  validUntil: string | null;
  noExpiry: boolean;
}

export interface ExpiryReminder {
  id: string;
  documentId: string;
  subjectKind: MaintenanceSubject;
  subjectId: string;
  title: string;
  dueDate: string;
  daysRemaining: number;
  status: 'upcoming' | 'due_today' | 'overdue' | 'resolved';
}
