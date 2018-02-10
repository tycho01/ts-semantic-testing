import * as ts from "typescript";
import { Options } from "./index";

export class BlockTransformer {
    private readonly context: ts.TransformationContext;
    private readonly program: ts.Program;

    constructor(context: ts.TransformationContext, program: ts.Program) {
        this.context = context;
        this.program = program;
    }

    public visitSourceFile(node: ts.SourceFile): ts.SourceFile {
        return this.visitNodeAndChildren(node);
    }

    private visitNodeAndChildren<T extends ts.Node>(node: T): T {
        return ts.visitEachChild(this.visitNode(node), childNode => this.visitNodeAndChildren(childNode), this.context);
    }

    private visitNode<T extends ts.Node>(node: T): T {
        ts.visitEachChild(node, child => this.visitNode(child), this.context);

        if (!ts.isCallExpression(node)) return node;
        if (!ts.isIdentifier(node.expression)) return node;
        if (node.expression.text !== "tsst") return node;
        if (node.arguments.length !== 1) return node;

        const arg = node.arguments[0];

        if (!ts.isFunctionExpression(arg) && !ts.isArrowFunction(arg)) return node;

        return ts.updateCall(
            node,
            node.expression,
            node.typeArguments,
            [this.visitTsstFunction(arg)]
        ) as ts.Node as T;
    }

    private visitTsstFunction(node: ts.FunctionExpression | ts.ArrowFunction) {
        if (ts.isFunctionExpression(node)) {
            return ts.updateFunctionExpression(
                node,
                node.modifiers,
                node.asteriskToken,
                node.name,
                node.typeParameters,
                node.parameters,
                node.type,
                this.visitTsstBlock(node.body)
            );
        } else {
            return ts.updateArrowFunction(
                node,
                node.modifiers,
                node.typeParameters,
                node.parameters,
                node.type,
                this.visitTsstBlock(node.body)
            );
        }
    }

    private visitTsstBlock(node: ts.ConciseBody): ts.Block {
        const diagnostics = this.program.getSemanticDiagnostics(node.getSourceFile());
        const containedDiagnostics = diagnostics.filter(diagnostic => {
            // I'm not sure when this location info might be undefined, just ignoring for now
            if (diagnostic.start === undefined) return false;
            if (diagnostic.length === undefined) return false;
            if (diagnostic.start < node.getStart()) return false;
            if (diagnostic.start + diagnostic.length! > node.getEnd()) return false;
            return true;
        });

        // Error.stackTraceLimit = 0;
        const traceStatement = ts.createStatement(
            ts.createAssignment(
                ts.createPropertyAccess(ts.createIdentifier("Error"), "stackTraceLimit"),
                ts.createLiteral(0)
            )
        );

        const errors = containedDiagnostics.map(diagnostic => {
            const errorExpression = ts.createNew(
                ts.createIdentifier("Error"),
                [],
                [ts.createLiteral(typeof diagnostic.messageText === "string" ?
                    diagnostic.messageText : diagnostic.messageText.messageText)]
            );

            ts.setSourceMapRange(errorExpression, {
                pos: diagnostic.start!,
                end: diagnostic.start! + diagnostic.length!
            });

            return errorExpression;
        });

        const returnStatement = ts.createReturn(
            ts.createArrayLiteral([], true)
        );

        const throwStatement = ts.createThrow(
            ts.createElementAccess(
                ts.createArrayLiteral(errors, true)
            , ts.createLiteral(0))
        );

        return ts.createBlock(
            (errors.length ? [traceStatement, throwStatement] : [returnStatement]) as ts.Statement[],
            true
        );
    }
}
