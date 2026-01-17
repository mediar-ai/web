/**
 * Tests for schema-to-fields utility
 */

import { describe, it, expect } from "vitest";
import {
  schemaToFields,
  getFieldLabel,
  humanizeKey,
  getDefaultValue,
  validateField,
  validateForm,
  analyzeSchema,
} from "../schema-to-fields";
import { ElicitationSchema, JsonSchemaProperty } from "../types";

describe("humanizeKey", () => {
  it("converts camelCase to human readable", () => {
    expect(humanizeKey("userName")).toBe("User Name");
    expect(humanizeKey("firstName")).toBe("First Name");
  });

  it("converts snake_case to human readable", () => {
    expect(humanizeKey("user_name")).toBe("User Name");
    expect(humanizeKey("first_name")).toBe("First Name");
  });

  it("handles single words", () => {
    expect(humanizeKey("name")).toBe("Name");
    expect(humanizeKey("email")).toBe("Email");
  });

  it("handles consecutive uppercase", () => {
    expect(humanizeKey("userID")).toBe("User ID");
  });
});

describe("getFieldLabel", () => {
  it("uses title if provided", () => {
    const property: JsonSchemaProperty = { type: "string", title: "Full Name" };
    expect(getFieldLabel(property, "name")).toBe("Full Name");
  });

  it("uses description if no title", () => {
    const property: JsonSchemaProperty = { type: "string", description: "Enter your name" };
    expect(getFieldLabel(property, "name")).toBe("Enter your name");
  });

  it("falls back to humanized key", () => {
    const property: JsonSchemaProperty = { type: "string" };
    expect(getFieldLabel(property, "userName")).toBe("User Name");
  });
});

describe("getDefaultValue", () => {
  it("returns default if provided", () => {
    expect(getDefaultValue({ type: "string", default: "test" })).toBe("test");
    expect(getDefaultValue({ type: "number", default: 42 })).toBe(42);
  });

  it("returns empty string for string type", () => {
    expect(getDefaultValue({ type: "string" })).toBe("");
  });

  it("returns minimum or 0 for number/integer type", () => {
    expect(getDefaultValue({ type: "number" })).toBe(0);
    expect(getDefaultValue({ type: "integer" })).toBe(0);
    expect(getDefaultValue({ type: "number", minimum: 5 })).toBe(5);
  });

  it("returns false for boolean type", () => {
    expect(getDefaultValue({ type: "boolean" })).toBe(false);
  });
});

describe("schemaToFields", () => {
  it("converts simple string property", () => {
    const schema: ElicitationSchema = {
      type: "object",
      properties: {
        name: { type: "string" },
      },
    };

    const fields = schemaToFields(schema);
    expect(fields).toHaveLength(1);
    expect(fields[0].key).toBe("name");
    expect(fields[0].property.type).toBe("string");
    expect(fields[0].required).toBe(false);
  });

  it("assigns shortcuts to enum properties", () => {
    const schema: ElicitationSchema = {
      type: "object",
      properties: {
        color: {
          type: "string",
          enum: ["red", "green", "blue"],
        },
      },
    };

    const fields = schemaToFields(schema);
    expect(fields[0].shortcut).toBe("1");
  });

  it("marks required fields", () => {
    const schema: ElicitationSchema = {
      type: "object",
      properties: {
        name: { type: "string" },
        email: { type: "string" },
      },
      required: ["name"],
    };

    const fields = schemaToFields(schema);
    const nameField = fields.find(f => f.key === "name");
    const emailField = fields.find(f => f.key === "email");

    expect(nameField?.required).toBe(true);
    expect(emailField?.required).toBe(false);
  });

  it("handles empty schema", () => {
    const schema: ElicitationSchema = {
      type: "object",
      properties: {},
    };

    const fields = schemaToFields(schema);
    expect(fields).toHaveLength(0);
  });
});

describe("validateField", () => {
  it("validates required fields", () => {
    const property: JsonSchemaProperty = { type: "string" };

    expect(validateField("", property, true)).toBe("This field is required");
    expect(validateField("John", property, true)).toBeNull();
  });

  it("passes for optional empty fields", () => {
    const property: JsonSchemaProperty = { type: "string" };
    expect(validateField("", property, false)).toBeNull();
  });

  it("validates enum values", () => {
    const property: JsonSchemaProperty = {
      type: "string",
      enum: ["red", "green", "blue"],
    };

    expect(validateField("red", property, true)).toBeNull();
    expect(validateField("yellow", property, true)).toBe("Must be one of: red, green, blue");
  });
});

describe("validateForm", () => {
  it("validates all fields", () => {
    const schema: ElicitationSchema = {
      type: "object",
      properties: {
        name: { type: "string" },
        email: { type: "string" },
      },
      required: ["name", "email"],
    };
    const fields = schemaToFields(schema);

    const errors = validateForm({ name: "", email: "" }, fields);
    expect(errors.name).toBe("This field is required");
    expect(errors.email).toBe("This field is required");
  });

  it("returns empty object for valid form", () => {
    const schema: ElicitationSchema = {
      type: "object",
      properties: {
        name: { type: "string" },
      },
      required: ["name"],
    };
    const fields = schemaToFields(schema);

    const errors = validateForm({ name: "John" }, fields);
    expect(errors).toEqual({});
  });
});

describe("analyzeSchema", () => {
  it("detects single enum (choice question)", () => {
    const schema: ElicitationSchema = {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["continue", "retry", "cancel"],
        },
      },
    };

    const analysis = analyzeSchema(schema);
    expect(analysis.isSingleEnum).toBe(true);
    expect(analysis.totalCount).toBe(1);
    expect(analysis.enumCount).toBe(1);
  });

  it("detects complex form", () => {
    const schema: ElicitationSchema = {
      type: "object",
      properties: {
        name: { type: "string" },
        age: { type: "integer" },
      },
    };

    const analysis = analyzeSchema(schema);
    expect(analysis.isSingleEnum).toBe(false);
    expect(analysis.totalCount).toBe(2);
  });
});
