import jp from "jsonpath";

import { getStringIfNotScalar, isDict } from "./utils/typeUtils";

import { Tests, ResponseData, Assertion, SpecResult } from "./models";
import { mergePrefixBasedTests } from "./mergeData";

function hasFailure(res: SpecResult): boolean {
  return res.results.some((r) => !r.pass) || res.subResults.some(hasFailure);
}

export function runAllTests(
  tests: Tests,
  responseData: ResponseData,
  stopOnFailure: boolean,
  rootSpec: string | null = null,
  skip?: boolean,
): SpecResult {
  const res: SpecResult = { spec: rootSpec, results: [], subResults: [] };
  if (!tests) return res;

  if (tests.status) {
    const expected = tests.status;
    const received = responseData.status;
    const statusResults = runTest("status", expected, received, skip);

    res.subResults.push(statusResults);
  }
  if (stopOnFailure && hasFailure(res)) return res;

  for (const spec in tests.headers) {
    const expected = tests.headers[spec];
    const received = responseData.headers ? responseData.headers[spec] : "";
    const headerResults = runTest(spec, expected, received, skip);

    res.subResults.push(headerResults);
  }

  for (const spec in tests.json) {
    let expected = tests.json[spec],
      received;
    try {
      received = getValueForJSONTests(responseData.json, spec);
    } catch (err: any) {
      res.subResults.push({
        spec,
        skipped: skip || (typeof expected === "object" && expected !== null && expected["$skip"]),
        results: [{ pass: false, expected, received: "", op: spec, message: err }],
        subResults: [],
      });
      continue;
    }

    const jsonResults = runTest(spec, expected, received, skip);
    res.subResults.push(jsonResults);
  }

  if (tests.body) {
    const expected = tests.body;
    const received = responseData.body;
    const bodyResults = runTest("body", expected, received, skip);

    res.subResults.push(bodyResults);
  }

  return res;
}

function runTest(spec: string, expected: Assertion, received: any, skip?: boolean): SpecResult {
  // typeof null is also 'object'
  if (expected !== null && typeof expected === "object")
    return runObjectTests(expected, received, spec, skip);

  expected = getStringIfNotScalar(expected);
  received = getStringIfNotScalar(received);
  const pass = expected === received;

  return { spec, skipped: skip, results: [{ pass, expected, received, op: ":" }], subResults: [] };
}

function getValueForJSONTests(responseContent: object, key: string): any {
  try {
    return jp.value(responseContent, key);
  } catch (err: any) {
    throw new Error(`Error while evaluating JSONPath ${key}: ${err.description || err.message || err}`);
  }
}

function runObjectTests(
  opVals: { [key: string]: any },
  receivedObject: any,
  spec: string,
  skip?: boolean,
): SpecResult {
  let objRes: SpecResult = { spec, results: [], subResults: [] };
  if (skip || opVals["$skip"]) objRes.skipped = true;

  for (const op in opVals) {
    let expected = getStringIfNotScalar(opVals[op]);
    let received = getStringIfNotScalar(receivedObject);

    let pass = false;
    let message = "";
    if (op === "$eq") {
      pass = received === expected;
    } else if (op === "$ne") {
      pass = received !== expected;
    } else if (op === "$lt") {
      pass = received < expected;
    } else if (op === "$gt") {
      pass = receivedObject > expected;
    } else if (op === "$lte") {
      pass = receivedObject <= expected;
    } else if (op === "$gte") {
      pass = receivedObject >= expected;
    } else if (op === "$size") {
      let receivedLen: number | undefined = undefined;
      if (typeof receivedObject === "object") {
        receivedLen = Object.keys(receivedObject).length;
      } else if (typeof receivedObject === "string" || Array.isArray(receivedObject)) {
        receivedLen = receivedObject.length;
      }
      if (typeof expected === "number") {
        pass = receivedLen === expected;
      } else {
        try {
          expected = JSON.parse(expected);

          // the spec remains the same, so we add it to the current layer
          const res = runObjectTests(expected, receivedLen, spec);
          objRes.results.push(...res.results);
          objRes.subResults.push(...res.subResults);
          continue;
        } catch (err: any) {
          pass = false;
          message = `$size val is not num or valid JSON`;
        }
      }
    } else if (op === "$exists") {
      const exists = received !== undefined;
      pass = exists === expected;
    } else if (op === "$type") {
      const receivedType = getType(receivedObject);
      pass = expected === receivedType;
      received = `${received} (type ${receivedType})`;
    } else if (op === "$regex") {
      const options = opVals["$options"];
      const regex = new RegExp(expected, options);
      try {
        pass = typeof received === "string" && regex.test(received);
      } catch (err: any) {
        message = err.message;
      }
    } else if (op === "$sw") {
      pass = typeof received === "string" && received.startsWith(expected);
    } else if (op === "$ew") {
      pass = typeof received === "string" && received.endsWith(expected);
    } else if (op === "$co") {
      pass = typeof received === "string" && received.includes(expected);
    } else if (op === "$options") {
      continue; // do nothing. $regex will address it.
    } else if (op === "$tests") {
      const recursiveTests = opVals[op];

      if (!isDict(recursiveTests)) {
        pass = false;
        message = "recursive tests must be dicts";
      } else {
        mergePrefixBasedTests(recursiveTests);
        const receivedObj: ResponseData = {
          executionTime: 0,
          body: "",
          rawHeaders: "",
          headers: {},
          json: receivedObject,
        };

        // the spec remains the same, so we add it to the current layer
        const res = runAllTests(recursiveTests, receivedObj, false, spec, objRes.skipped);
        objRes.results.push(...res.results);
        objRes.subResults.push(...res.subResults);
        continue;
      }
    } else if (op === "$skip") {
      continue; // do nothing. If it wasn't already addressed, that means the test is not to be skipped.
    } else {
      objRes.results.push({
        pass: false,
        expected: "one of $eq, $ne etc.",
        received: op,
        op: "",
        message: "To compare objects, use $eq",
      });
      continue;
    }
    objRes.results.push({ pass, expected, received, op, message });
  }

  return objRes;
}

function getType(data: any): string {
  if (data === null) {
    return "null";
  } else if (Array.isArray(data)) {
    return "array";
  } else {
    return typeof data;
  }
}
