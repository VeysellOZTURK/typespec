import {
  BooleanLiteral,
  compilerAssert,
  Enum,
  EnumMember,
  Interface,
  IntrinsicType,
  isTemplateDeclaration,
  Model,
  ModelProperty,
  Namespace,
  NumericLiteral,
  Operation,
  Program,
  Scalar,
  StringLiteral,
  Tuple,
  Type,
  Union,
  UnionVariant,
} from "../core/index.js";
import { code, StringBuilder } from "./builders/string-builder.js";
import { Placeholder } from "./placeholder.js";
import {
  AssetEmitter,
  CadlDeclaration,
  Context,
  Declaration,
  EmitEntity,
  EmittedSourceFile,
  Scope,
  SourceFile,
} from "./types.js";

export type EmitterOutput<T> = EmitEntity<T> | Placeholder<T> | T;

/**
 * Implement emitter logic by extending this class and passing it to
 * `emitContext.createAssetEmitter`. This class should not be constructed
 * directly.
 *
 * TypeEmitters serve two primary purposes:
 *
 * 1. Handle emitting TypeSpec types into other languages
 * 2. Set emitter context
 *
 * The generic type parameter `T` is the type you expect to produce for each TypeSpec type.
 * In the case of generating source code for a programming language, this is probably `string`
 * (in which case, consider using the `CodeTypeEmitter`) but might also be an AST node. If you
 * are emitting JSON or similar, `T` would likely be `object`.
 *
 * ## Emitting types
 *
 * Emitting TypeSpec types into other languages is accomplished by implementing
 * the AssetEmitter method that corresponds with the TypeSpec type you are
 * emitting. For example, to emit a TypeSpec model declaration, implement the
 * `modelDeclaration` method.
 *
 * TypeSpec types that have both declaration and literal forms like models or
 * unions will have separate methods. For example, models have both
 * `modelDeclaration` and `modelLiteral` methods that can be implemented
 * separately.
 *
 * Also, types which can be instantiated like models or operations have a
 * separate method for the instantiated type. For example, models have a
 * `modelInstantiation` method that gets called with such types. Generally these
 * will be treated either as if they were declarations or literals depending on
 * preference, but may also be treated specially.
 *
 * ## Emitter results
 * There are three kinds of results your methods might return - declarations,
 * raw code, or nothing.
 *
 * ### Declarations
 *
 * Create declarations by calling `this.emitter.result.declaration` passing it a
 * name and the emit output for the declaration. Note that you must have scope
 * in your context or you will get an error. If you want all declarations to be
 * emitted to the same source file, you can create a single scope in
 * `programContext` via something like:
 *
 * ```typescript
 * programContext(program: Program): Context {
 *   const sourceFile = this.emitter.createSourceFile("test.txt");
 *   return {
 *     scope: sourceFile.globalScope,
 *   };
 * }
 * ```
 *
 * ### Raw Code
 *
 * Create raw code, or emitter output that doesn't contribute to a declaration,
 * by calling `this.emitter.result.rawCode` passing it a value. Returning just a
 * value is considered raw code and so you often don't need to call this
 * directly.
 *
 * ### No Emit
 *
 * When a type doesn't contribute anything to the emitted output, return
 * `this.emitter.result.none()`.
 *
 * ## Context
 *
 * The TypeEmitter will often want to keep track of what context a type is found
 * in. There are two kinds of context - lexical context, and reference context.
 *
 * * Lexical context is context that applies to the type and every type
 *   contained inside of it. For example, lexical context for a model will apply
 *   to the model, its properties, and any nested model literals.
 * * Reference context is context that applies to types contained inside of the
 *   type and referenced anywhere inside of it. For example, reference context
 *   set on a model will apply to the model, its properties, any nested model
 *   literals, and any type referenced inside anywhere inside the model and any
 *   of the referenced types' references.
 *
 * In both cases, context is an object. It strongly recommended that the context
 * object either contain only primitive types, or else only reference immutable
 * objects.
 *
 * Set lexical by implementing the `*Context` methods of the TypeEmitter and
 * returning the context, for example `modelDeclarationContext` sets the context
 * for model declarations and the types contained inside of it.
 *
 * Set reference context by implementing the `*ReferenceContext` methods of the
 * TypeEmitter and returning the context. Note that not all types have reference
 * context methods, because not all types can actually reference anything.
 *
 * When a context method returns some context, it is merged with the current
 * context. It is not possible to remove previous context, but it can be
 * overridden with `undefined`.
 *
 * When emitting types with context, the same type might be emitted multiple
 * times if we come across that type with different contexts. For example, if we
 * have a TypeSpec program like
 *
 * ```cadl
 * model Pet { }
 * model Person {
 *   pet: Pet;
 * }
 * ```
 *
 * And we set reference context for the Person model, Pet will be emitted twice,
 * once without context and once with the reference context.
 */
export class TypeEmitter<T, TOptions extends object = Record<string, never>> {
  /**
   * @private
   *
   * Constructs a TypeEmitter. Do not use this constructor directly, instead
   * call `createAssetEmitter` on the emitter context object.
   * @param emitter The asset emitter
   */
  constructor(protected emitter: AssetEmitter<T, TOptions>) {}

  /**
   * Context shared by the entire program. In cases where you are emitting to a
   * single file, use this method to establish your main source file and set the
   * `scope` property to that source file's `globalScope`.
   * @param program
   * @returns Context
   */
  programContext(program: Program): Context {
    return {};
  }

  /**
   * Emit a namespace
   *
   * @param namespace
   * @returns Emitter output
   */
  namespace(namespace: Namespace): EmitterOutput<T> {
    for (const ns of namespace.namespaces.values()) {
      this.emitter.emitType(ns);
    }

    for (const model of namespace.models.values()) {
      if (!isTemplateDeclaration(model)) {
        this.emitter.emitType(model);
      }
    }

    for (const operation of namespace.operations.values()) {
      if (!isTemplateDeclaration(operation)) {
        this.emitter.emitType(operation);
      }
    }

    for (const enumeration of namespace.enums.values()) {
      this.emitter.emitType(enumeration);
    }

    for (const union of namespace.unions.values()) {
      if (!isTemplateDeclaration(union)) {
        this.emitter.emitType(union);
      }
    }

    for (const iface of namespace.interfaces.values()) {
      if (!isTemplateDeclaration(iface)) {
        this.emitter.emitType(iface);
      }
    }
    return this.emitter.result.none();
  }

  /**
   * Set lexical context for a namespace
   *
   * @param namespace
   */
  namespaceContext(namespace: Namespace): Context {
    return {};
  }

  /**
   * Set reference context for a namespace.
   *
   * @param namespace
   */
  namespaceReferenceContext(namespace: Namespace): Context {
    return {};
  }

  /**
   * Emit a model literal (e.g. as created by `{}` syntax in TypeSpec).
   *
   * @param model
   */
  modelLiteral(model: Model): EmitterOutput<T> {
    if (model.baseModel) {
      this.emitter.emitType(model.baseModel);
    }

    this.emitter.emitModelProperties(model);
    return this.emitter.result.none();
  }

  /**
   * Set lexical context for a model literal.
   * @param model
   */
  modelLiteralContext(model: Model): Context {
    return {};
  }

  /**
   * Set reference context for a model literal.
   * @param model
   */
  modelLiteralReferenceContext(model: Model): Context {
    return {};
  }

  /**
   * Emit a model declaration (e.g. as created by `model Foo { }` syntax in
   * TypeSpec).
   *
   * @param model
   */
  modelDeclaration(model: Model, name: string): EmitterOutput<T> {
    if (model.baseModel) {
      this.emitter.emitType(model.baseModel);
    }
    this.emitter.emitModelProperties(model);
    return this.emitter.result.none();
  }

  /**
   * Set lexical context for a model declaration.
   *
   * @param model
   * @param name the model's declaration name as retrieved from the
   * `declarationName` method.
   */
  modelDeclarationContext(model: Model, name: string): Context {
    return {};
  }

  /**
   * Set reference context for a model declaration.
   * @param model
   */
  modelDeclarationReferenceContext(model: Model): Context {
    return {};
  }

  /**
   * Emit a model instantiation (e.g. as created by `Foo<string>` syntax in
   * TypeSpec).
   *
   * @param model
   * @param name The name of the instantiation as retrieved from the
   * `declarationName` method.
   */
  modelInstantiation(model: Model, name: string): EmitterOutput<T> {
    if (model.baseModel) {
      this.emitter.emitType(model.baseModel);
    }
    this.emitter.emitModelProperties(model);
    return this.emitter.result.none();
  }

  /**
   * Set lexical context for a model instantiation.
   * @param model
   */
  modelInstantiationContext(model: Model): Context {
    return {};
  }

  /**
   * Set reference context for a model declaration.
   * @param model
   */
  modelInstantiationReferenceContext(model: Model): Context {
    return {};
  }

  /**
   * Emit a model's properties. Unless overridden, this method will emit each of
   * the model's properties and return a no emit result.
   *
   * @param model
   */
  modelProperties(model: Model): EmitterOutput<T> {
    for (const prop of model.properties.values()) {
      this.emitter.emitModelProperty(prop);
    }
    return this.emitter.result.none();
  }

  /**
   * Emit a property of a model.
   *
   * @param property
   */
  modelPropertyLiteral(property: ModelProperty): EmitterOutput<T> {
    this.emitter.emitTypeReference(property.type);
    return this.emitter.result.none();
  }

  /**
   * Set lexical context for a property of a model.
   *
   * @param property
   */
  modelPropertyLiteralContext(property: ModelProperty): Context {
    return {};
  }

  /**
   * Set reference context for a property of a model.
   *
   * @param property
   */
  modelPropertyLiteralReferenceContext(property: ModelProperty): Context {
    return {};
  }

  /**
   * Emit a model property reference (e.g. as created by the `SomeModel.prop`
   * syntax in TypeSpec). By default, this will emit the type of the referenced
   * property and return that result. In other words, the emit will look as if
   * `SomeModel.prop` were replaced with the type of `prop`.
   *
   * @param property
   */
  modelPropertyReference(property: ModelProperty): EmitterOutput<T> {
    return this.emitter.emitTypeReference(property.type);
  }

  arrayDeclaration(array: Model, name: string, elementType: Type): EmitterOutput<T> {
    this.emitter.emitType(array.indexer!.value);
    return this.emitter.result.none();
  }

  arrayDeclarationContext(array: Model): Context {
    return {};
  }

  arrayDeclarationReferenceContext(array: Model): Context {
    this.emitter.emitType(array.indexer!.value);
    return {};
  }

  arrayLiteral(array: Model, elementType: Type): EmitterOutput<T> {
    return this.emitter.result.none();
  }

  arrayLiteralContext(array: Model): Context {
    return {};
  }

  arrayLiteralReferenceContext(array: Model): Context {
    return {};
  }

  scalarDeclaration(scalar: Scalar, name: string): EmitterOutput<T> {
    if (scalar.baseScalar) {
      this.emitter.emitType(scalar.baseScalar);
    }
    return this.emitter.result.none();
  }

  scalarDeclarationContext(scalar: Scalar): Context {
    return {};
  }

  intrinsic(intrinsic: IntrinsicType, name: string): EmitterOutput<T> {
    return this.emitter.result.none();
  }

  intrinsicContext(intrinsic: IntrinsicType): Context {
    return {};
  }
  booleanLiteralContext(boolean: BooleanLiteral): Context {
    return {};
  }

  booleanLiteral(boolean: BooleanLiteral): EmitterOutput<T> {
    return this.emitter.result.none();
  }

  stringLiteralContext(string: StringLiteral): Context {
    return {};
  }

  stringLiteral(string: StringLiteral): EmitterOutput<T> {
    return this.emitter.result.none();
  }

  numericLiteralContext(number: NumericLiteral): Context {
    return {};
  }

  numericLiteral(number: NumericLiteral): EmitterOutput<T> {
    return this.emitter.result.none();
  }

  operationDeclaration(operation: Operation, name: string): EmitterOutput<T> {
    this.emitter.emitOperationParameters(operation);
    this.emitter.emitOperationReturnType(operation);

    return this.emitter.result.none();
  }

  operationDeclarationContext(operation: Operation): Context {
    return {};
  }

  operationDeclarationReferenceContext(operation: Operation): Context {
    return {};
  }

  operationParameters(operation: Operation, parameters: Model): EmitterOutput<T> {
    return this.emitter.result.none();
  }

  operationParametersContext(operation: Operation, parameters: Model): Context {
    return {};
  }

  operationParametersReferenceContext(operation: Operation, parameters: Model): Context {
    return {};
  }

  operationReturnType(operation: Operation, returnType: Type): EmitterOutput<T> {
    return this.emitter.result.none();
  }

  operationReturnTypeContext(operation: Operation, returnType: Type): Context {
    return {};
  }

  operationReturnTypeReferenceContext(operation: Operation, returnType: Type): Context {
    return {};
  }

  interfaceDeclaration(iface: Interface, name: string): EmitterOutput<T> {
    this.emitter.emitInterfaceOperations(iface);
    return this.emitter.result.none();
  }

  interfaceDeclarationContext(iface: Interface): Context {
    return {};
  }

  interfaceDeclarationReferenceContext(iface: Interface): Context {
    return {};
  }

  interfaceDeclarationOperations(iface: Interface): EmitterOutput<T> {
    for (const op of iface.operations.values()) {
      this.emitter.emitInterfaceOperation(op);
    }
    return this.emitter.result.none();
  }

  interfaceOperationDeclaration(operation: Operation, name: string): EmitterOutput<T> {
    this.emitter.emitOperationParameters(operation);
    this.emitter.emitOperationReturnType(operation);

    return this.emitter.result.none();
  }

  interfaceOperationDeclarationContext(operation: Operation): Context {
    return {};
  }

  interfaceOperationDeclarationReferenceContext(operation: Operation): Context {
    return {};
  }

  enumDeclaration(en: Enum, name: string): EmitterOutput<T> {
    this.emitter.emitEnumMembers(en);
    return this.emitter.result.none();
  }

  enumDeclarationContext(en: Enum): Context {
    return {};
  }

  enumMembers(en: Enum): EmitterOutput<T> {
    for (const member of en.members.values()) {
      this.emitter.emitType(member);
    }
    return this.emitter.result.none();
  }

  enumMember(member: EnumMember): EmitterOutput<T> {
    return this.emitter.result.none();
  }

  enumMemberContext(member: EnumMember) {
    return {};
  }

  unionDeclaration(union: Union, name: string): EmitterOutput<T> {
    this.emitter.emitUnionVariants(union);
    return this.emitter.result.none();
  }

  unionDeclarationContext(union: Union): Context {
    return {};
  }

  unionDeclarationReferenceContext(union: Union): Context {
    return {};
  }

  unionInstantiation(union: Union, name: string): EmitterOutput<T> {
    this.emitter.emitUnionVariants(union);
    return this.emitter.result.none();
  }

  unionInstantiationContext(union: Union): Context {
    return {};
  }

  unionInstantiationReferenceContext(union: Union): Context {
    return {};
  }

  unionLiteral(union: Union): EmitterOutput<T> {
    this.emitter.emitUnionVariants(union);
    return this.emitter.result.none();
  }

  unionLiteralContext(union: Union): Context {
    return {};
  }

  unionLiteralReferenceContext(union: Union): Context {
    return {};
  }

  unionVariants(union: Union): EmitterOutput<T> {
    for (const variant of union.variants.values()) {
      this.emitter.emitType(variant);
    }
    return this.emitter.result.none();
  }

  unionVariant(variant: UnionVariant): EmitterOutput<T> {
    this.emitter.emitTypeReference(variant.type);
    return this.emitter.result.none();
  }
  unionVariantContext(union: Union): Context {
    return {};
  }

  unionVariantReferenceContext(union: Union): Context {
    return {};
  }

  tupleLiteral(tuple: Tuple): EmitterOutput<T> {
    this.emitter.emitTupleLiteralValues(tuple);
    return this.emitter.result.none();
  }

  tupleLiteralContext(tuple: Tuple): Context {
    return {};
  }

  tupleLiteralValues(tuple: Tuple): EmitterOutput<T> {
    for (const value of tuple.values.values()) {
      this.emitter.emitType(value);
    }
    return this.emitter.result.none();
  }

  tupleLiteralReferenceContext(tuple: Tuple): Context {
    return {};
  }

  sourceFile(sourceFile: SourceFile<T>): EmittedSourceFile {
    const emittedSourceFile: EmittedSourceFile = {
      path: sourceFile.path,
      contents: "",
    };

    for (const decl of sourceFile.globalScope.declarations) {
      emittedSourceFile.contents += decl.value + "\n";
    }

    return emittedSourceFile;
  }

  reference(
    targetDeclaration: Declaration<T>,
    pathUp: Scope<T>[],
    pathDown: Scope<T>[],
    commonScope: Scope<T> | null
  ): EmitEntity<T> | T {
    return this.emitter.result.none();
  }

  declarationName(declarationType: CadlDeclaration): string {
    compilerAssert(
      declarationType.name !== undefined,
      "Can't emit a declaration that doesn't have a name."
    );

    if (declarationType.kind === "Enum") {
      return declarationType.name;
    }

    // for operations inside interfaces, we don't want to do the fancy thing because it will make
    // operations inside instantiated interfaces get weird names
    if (declarationType.kind === "Operation" && declarationType.interface) {
      return declarationType.name;
    }

    if (!declarationType.templateMapper) {
      return declarationType.name;
    }

    const parameterNames = declarationType.templateMapper.args.map((t) => {
      switch (t.kind) {
        case "Model":
        case "Scalar":
        case "Interface":
        case "Operation":
        case "Enum":
        case "Union":
          return this.emitter.emitDeclarationName(t);
        default:
          compilerAssert(
            false,
            `Can't get a declaration name for non-declaration type ${t.kind} used to instantiate a template.`
          );
      }
    });

    return declarationType.name + parameterNames.join("");
  }
}

/**
 * A subclass of `TypeEmitter<string>` that makes working with strings a bit easier.
 * In particular, when emitting members of a type (`modelProperties`, `enumMembers`, etc.),
 * instead of returning no result, it returns the value of each of the members concatenated
 * by commas. It will also construct references by concatenating namespace elements together
 * with `.` which should work nicely in many object oriented languages.
 */
export class CodeTypeEmitter<TOptions extends object = Record<string, never>> extends TypeEmitter<
  string,
  TOptions
> {
  modelProperties(model: Model): EmitterOutput<string> {
    const builder = new StringBuilder();
    let i = 0;
    for (const prop of model.properties.values()) {
      i++;
      const propVal = this.emitter.emitModelProperty(prop);
      builder.push(code`${propVal}${i < model.properties.size ? "," : ""}`);
    }
    return this.emitter.result.rawCode(builder.reduce());
  }

  interfaceDeclarationOperations(iface: Interface): EmitterOutput<string> {
    const builder = new StringBuilder();
    let i = 0;
    for (const op of iface.operations.values()) {
      i++;
      builder.push(
        code`${this.emitter.emitInterfaceOperation(op)}${i < iface.operations.size ? "," : ""}`
      );
    }
    return builder.reduce();
  }

  enumMembers(en: Enum): EmitterOutput<string> {
    const builder = new StringBuilder();
    let i = 0;
    for (const enumMember of en.members.values()) {
      i++;
      builder.push(code`${this.emitter.emitType(enumMember)}${i < en.members.size ? "," : ""}`);
    }
    return builder.reduce();
  }

  unionVariants(union: Union): EmitterOutput<string> {
    const builder = new StringBuilder();
    let i = 0;
    for (const v of union.variants.values()) {
      i++;
      builder.push(code`${this.emitter.emitType(v)}${i < union.variants.size ? "," : ""}`);
    }
    return builder.reduce();
  }

  tupleLiteralValues(tuple: Tuple): EmitterOutput<string> {
    const builder = new StringBuilder();
    let i = 0;
    for (const v of tuple.values) {
      i++;
      ``;
      builder.push(code`${this.emitter.emitTypeReference(v)}${i < tuple.values.length ? "," : ""}`);
    }
    return builder.reduce();
  }

  reference(
    targetDeclaration: Declaration<string>,
    pathUp: Scope<string>[],
    pathDown: Scope<string>[],
    commonScope: Scope<string> | null
  ): string | EmitEntity<string> {
    const basePath = pathDown.map((s) => s.name).join(".");
    return basePath
      ? this.emitter.result.rawCode(basePath + "." + targetDeclaration.name)
      : this.emitter.result.rawCode(targetDeclaration.name);
  }
}
