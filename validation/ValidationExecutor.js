"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var ValidationError_1 = require("./ValidationError");
var MetadataStorage_1 = require("../metadata/MetadataStorage");
var container_1 = require("../container");
var ValidationTypes_1 = require("./ValidationTypes");
var ValidationUtils_1 = require("./ValidationUtils");
/**
 * Executes validation over given object.
 */
var ValidationExecutor = /** @class */ (function () {
    // -------------------------------------------------------------------------
    // Constructor
    // -------------------------------------------------------------------------
    function ValidationExecutor(validator, validatorOptions) {
        this.validator = validator;
        this.validatorOptions = validatorOptions;
        // -------------------------------------------------------------------------
        // Properties
        // -------------------------------------------------------------------------
        this.awaitingPromises = [];
        this.ignoreAsyncValidations = false;
        // -------------------------------------------------------------------------
        // Private Properties
        // -------------------------------------------------------------------------
        this.metadataStorage = container_1.getFromContainer(MetadataStorage_1.MetadataStorage);
    }
    // -------------------------------------------------------------------------
    // Public Methods
    // -------------------------------------------------------------------------
    ValidationExecutor.prototype.execute = function (object, targetSchema, validationErrors) {
        var _this = this;
        var groups = this.validatorOptions ? this.validatorOptions.groups : undefined;
        var targetMetadatas = this.metadataStorage.getTargetValidationMetadatas(object.constructor, targetSchema, groups);
        var groupedMetadatas = this.metadataStorage.groupByPropertyName(targetMetadatas);
        Object.keys(groupedMetadatas).forEach(function (propertyName) {
            var value = object[propertyName];
            var definedMetadatas = groupedMetadatas[propertyName].filter(function (metadata) { return metadata.type === ValidationTypes_1.ValidationTypes.IS_DEFINED; });
            var metadatas = groupedMetadatas[propertyName].filter(function (metadata) { return metadata.type !== ValidationTypes_1.ValidationTypes.IS_DEFINED; });
            var customValidationMetadatas = metadatas.filter(function (metadata) { return metadata.type === ValidationTypes_1.ValidationTypes.CUSTOM_VALIDATION; });
            var nestedValidationMetadatas = metadatas.filter(function (metadata) { return metadata.type === ValidationTypes_1.ValidationTypes.NESTED_VALIDATION; });
            var conditionalValidationMetadatas = metadatas.filter(function (metadata) { return metadata.type === ValidationTypes_1.ValidationTypes.CONDITIONAL_VALIDATION; });
            var validationError = _this.generateValidationError(object, value, propertyName);
            validationErrors.push(validationError);
            var canValidate = _this.conditionalValidations(object, value, conditionalValidationMetadatas);
            if (!canValidate) {
                return;
            }
            // handle IS_DEFINED validation type the special way - it should work no matter skipMissingProperties is set or not
            _this.defaultValidations(object, value, definedMetadatas, validationError.constraints);
            if ((value === null || value === undefined) && _this.validatorOptions && _this.validatorOptions.skipMissingProperties === true) {
                return;
            }
            _this.defaultValidations(object, value, metadatas, validationError.constraints);
            _this.customValidations(object, value, customValidationMetadatas, validationError.constraints);
            _this.nestedValidations(value, nestedValidationMetadatas, validationError.children);
        });
    };
    ValidationExecutor.prototype.stripEmptyErrors = function (errors) {
        var _this = this;
        return errors.filter(function (error) {
            if (error.children) {
                error.children = _this.stripEmptyErrors(error.children);
            }
            if (Object.keys(error.constraints).length === 0) {
                if (error.children.length === 0) {
                    return false;
                }
                else {
                    delete error.constraints;
                }
            }
            return true;
        });
    };
    // -------------------------------------------------------------------------
    // Private Methods
    // -------------------------------------------------------------------------
    ValidationExecutor.prototype.generateValidationError = function (object, value, propertyName) {
        var validationError = new ValidationError_1.ValidationError();
        if (!this.validatorOptions ||
            !this.validatorOptions.validationError ||
            this.validatorOptions.validationError.target === undefined ||
            this.validatorOptions.validationError.target === true)
            validationError.target = object;
        if (!this.validatorOptions ||
            !this.validatorOptions.validationError ||
            this.validatorOptions.validationError.value === undefined ||
            this.validatorOptions.validationError.value === true)
            validationError.value = value;
        validationError.property = propertyName;
        validationError.children = [];
        validationError.constraints = {};
        return validationError;
    };
    ValidationExecutor.prototype.conditionalValidations = function (object, value, metadatas) {
        return metadatas
            .map(function (metadata) { return metadata.constraints[0](object, value); })
            .reduce(function (resultA, resultB) { return resultA && resultB; }, true);
    };
    ValidationExecutor.prototype.defaultValidations = function (object, value, metadatas, errorMap) {
        var _this = this;
        return metadatas
            .filter(function (metadata) {
            if (metadata.each) {
                if (value instanceof Array) {
                    return !value.every(function (subValue) { return _this.validator.validateValueByMetadata(subValue, metadata); });
                }
            }
            else {
                return !_this.validator.validateValueByMetadata(value, metadata);
            }
        })
            .forEach(function (metadata) {
            var _a = _this.createValidationError(object, value, metadata), key = _a[0], message = _a[1];
            errorMap[key] = message;
        });
    };
    ValidationExecutor.prototype.customValidations = function (object, value, metadatas, errorMap) {
        var _this = this;
        metadatas.forEach(function (metadata) {
            container_1.getFromContainer(MetadataStorage_1.MetadataStorage)
                .getTargetValidatorConstraints(metadata.constraintCls)
                .forEach(function (customConstraintMetadata) {
                if (customConstraintMetadata.async && _this.ignoreAsyncValidations)
                    return;
                var validationArguments = {
                    targetName: object.constructor ? object.constructor.name : undefined,
                    property: metadata.propertyName,
                    object: object,
                    value: value,
                    constraints: metadata.constraints
                };
                var validatedValue = customConstraintMetadata.instance.validate(value, validationArguments);
                if (validatedValue instanceof Promise) {
                    var promise = validatedValue.then(function (isValid) {
                        if (!isValid) {
                            var _a = _this.createValidationError(object, value, metadata, customConstraintMetadata), type = _a[0], message = _a[1];
                            errorMap[type] = message;
                        }
                    });
                    _this.awaitingPromises.push(promise);
                }
                else {
                    if (!validatedValue) {
                        var _a = _this.createValidationError(object, value, metadata, customConstraintMetadata), type = _a[0], message = _a[1];
                        errorMap[type] = message;
                    }
                }
            });
        });
    };
    ValidationExecutor.prototype.nestedValidations = function (value, metadatas, errors) {
        var _this = this;
        if (value === void 0) {
            return;
        }
        metadatas.forEach(function (metadata) {
            if (metadata.type !== ValidationTypes_1.ValidationTypes.NESTED_VALIDATION)
                return;
            var targetSchema = typeof metadata.target === "string" ? metadata.target : undefined;
            if (value instanceof Array) {
                value.forEach(function (subValue, index) {
                    var validationError = _this.generateValidationError(value, subValue, index.toString());
                    errors.push(validationError);
                    _this.execute(subValue, targetSchema, validationError.children);
                });
            }
            else if (value instanceof Object) {
                _this.execute(value, targetSchema, errors);
            }
            else {
                throw new Error("Only objects and arrays are supported to nested validation");
            }
        });
    };
    ValidationExecutor.prototype.createValidationError = function (object, value, metadata, customValidatorMetadata) {
        var targetName = object.constructor ? object.constructor.name : undefined;
        var type = customValidatorMetadata && customValidatorMetadata.name ? customValidatorMetadata.name : metadata.type;
        var validationArguments = {
            targetName: targetName,
            property: metadata.propertyName,
            object: object,
            value: value,
            constraints: metadata.constraints
        };
        var message = metadata.message;
        if (!metadata.message &&
            (!this.validatorOptions || (this.validatorOptions && !this.validatorOptions.dismissDefaultMessages))) {
            if (customValidatorMetadata && customValidatorMetadata.instance.defaultMessage instanceof Function) {
                message = customValidatorMetadata.instance.defaultMessage(validationArguments);
            }
            if (!message)
                message = ValidationTypes_1.ValidationTypes.getMessage(type, metadata.each);
        }
        var messageString = ValidationUtils_1.ValidationUtils.replaceMessageSpecialTokens(message, validationArguments);
        return [type, messageString];
    };
    return ValidationExecutor;
}());
exports.ValidationExecutor = ValidationExecutor;

//# sourceMappingURL=ValidationExecutor.js.map
