import { useMemo } from 'react';
import { usePipelineEditor } from '../context/PipelineEditorContext';
import { validatePipeline } from '../validation/validatePipeline';
import type { ValidationResult } from '../../../types/pipeline';

export function usePipelineValidation(): ValidationResult {
  const { definition } = usePipelineEditor();
  return useMemo(
    () =>
      definition
        ? validatePipeline(definition)
        : { errors: [], warnings: [], isValid: true, canPublish: false },
    [definition],
  );
}
