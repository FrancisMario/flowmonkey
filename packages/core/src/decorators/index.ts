/**
 * Decorator system for FlowMonkey handlers.
 *
 * Provides type-safe, declarative handler definition through decorators.
 */

export {
  Handler,
  Input,
  SuccessOutput,
  FailureOutput,
  type HandlerOptions,
  type InputOptions,
  type OutputOptions,
  type InputSource,
} from './handler';

export {
  Min,
  Max,
  MinLength,
  MaxLength,
  Pattern,
  Email,
  Url,
  type ValidationRule,
} from './validation';

export {
  getHandlerMetadata,
  getInputMetadata,
  getOutputMetadata,
  getValidationRules,
  HANDLER_METADATA_KEY,
  INPUT_METADATA_KEY,
  OUTPUT_METADATA_KEY,
  VALIDATION_METADATA_KEY,
} from './metadata';
