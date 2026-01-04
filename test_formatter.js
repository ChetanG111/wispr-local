
const { format } = require('./formatter');

const testCases = [
    {
        name: "Spoken Commands",
        input: "hello new line world new paragraph next line comma and point one item point two item period",
        // Expect: hello \n world \n\n \n , and \n1. item \n2. item .
        // Casing will capitalize "World", "And", "Item".
    },
    {
        name: "Sentence Casing",
        input: "hello. world? yes! no\nnewline",
        // Expect: Hello. World? Yes! No\nNewline
    },
    {
        name: "Length Breaks",
        input: "This is a very long sentence that has absolutely no punctuation whatsoever and just keeps going on and on and on and on and on and on and on and on and on and on and on and on and on and on and on and on and it should definitely be split somewhere around the one hundred and forty character mark because that is the rule we implemented.",
        // Expect period insertion
    },
    {
        name: "Paragraph Heuristics",
        input: "Hello. okay let's go. so next topic. moving on now.",
        // Expect: Hello.\n\nOkay let's go.\n\nSo next topic.\n\nMoving on now.
    },
    {
        name: "Complex Mix",
        input: "start period next point list item 1 next point list item 2 new paragraph okay summary period",
        // Expect: Start. \n• List item 1 \n• List item 2 \n\nOkay summary.
    }
];

testCases.forEach(tc => {
    console.log(`\n--- Test: ${tc.name} ---`);
    console.log("Input:   ", JSON.stringify(tc.input));
    const output = format(tc.input);
    console.log("Output:  ", JSON.stringify(output));
});
