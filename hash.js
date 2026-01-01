const bcrypt = require("bcrypt");

(async () => {
  const plainPassword = "123456";
  const hash = await bcrypt.hash(plainPassword, 10);

  console.log("Plain :", plainPassword);
  console.log("Hash  :", hash);
})();
