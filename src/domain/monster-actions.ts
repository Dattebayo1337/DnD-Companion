// These SRD stat blocks were checked against their original text.
export function hasVerifiedNoActions(id: string): boolean {
  return [
    "837e3267-3033-5f96-a7ea-7e363e8643a8", // Shrieker, 2014 (reaction only)
    "e0598769-9e29-52e6-a13b-08cd6c21455a", // Frog, 2014
    "da7bad58-fb4e-5ecb-a8bb-1db78956de24", // Sea Horse, 2014
    "2f615b01-73ad-5a40-a674-c0e40becb52e", // Shrieker Fungus, 2024
  ].includes(id);
}
