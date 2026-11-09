"""Rebuild the bundled catalog from pinned, public USDA CSV downloads.

Download these ZIPs without extracting, then pass their paths in the same order:
https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_sr_legacy_food_csv_2018-04.zip
https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_survey_food_csv_2024-10-31.zip

USDA nutrition data are public domain (CC0): https://fdc.nal.usda.gov/api-guide/#licensing
Manufacturer records use cited Indian product-label values. Selected CoFID values are
transcribed from Public Health England’s Composition of Foods Integrated Dataset 2021
under the Open Government Licence v3.0: https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/
"""

import argparse
import collections
import csv
import io
import json
import math
from pathlib import Path
import re
import zipfile

parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
parser.add_argument('sr_legacy', type=Path, help='SR Legacy USDA ZIP')
parser.add_argument('fndds', type=Path, help='FNDDS USDA ZIP')
parser.add_argument('--output', type=Path, default=Path(__file__).resolve().parents[1] / 'site/nutrition/catalog.json')
options = parser.parse_args()
archives = {'sr-legacy': options.sr_legacy, 'fndds': options.fndds}

sr = """168893|atta|Whole-wheat flour|Grains & breads|atta;gehun ka atta
169761|maida|All-purpose flour|Grains & breads|maida
168933|sooji|Semolina|Grains & breads|sooji;suji;rava
169714|rice-flour|White rice flour|Grains & breads|chawal ka atta
174288|besan|Chickpea flour|Pulses & beans|besan;gram flour
169757|rice-cooked|White rice, cooked|Grains & breads|chawal;steamed rice;plain rice;basmati rice cooked
169756|rice-dry|White rice, dry|Grains & breads|kaccha chawal;raw rice;basmati rice raw
169704|brown-rice-cooked|Brown rice, cooked|Grains & breads|brown rice
169703|brown-rice-dry|Brown rice, dry|Grains & breads|raw brown rice
169759|parboiled-rice-cooked|Parboiled rice, cooked|Grains & breads|usna chawal
169702|millet-dry|Millet, dry|Grains & breads|millet grains
168871|millet-cooked|Millet, cooked|Grains & breads|boiled millet
169716|jowar|Sorghum grain, dry|Grains & breads|jowar;jowari
170682|rajgira|Amaranth grain, dry|Grains & breads|rajgira;ramdana
170683|amaranth-cooked|Amaranth grain, cooked|Grains & breads|rajgira cooked
168874|quinoa-dry|Quinoa, dry|Grains & breads|
168917|quinoa-cooked|Quinoa, cooked|Grains & breads|
173904|oats|Oats, dry|Grains & breads|oatmeal dry
171844|roti-commercial|Roti, plain packaged|Grains & breads|commercial chapati;store-bought roti
172420|lentils-dry|Lentils, dry|Pulses & beans|whole lentils;dry lentils
172421|lentils-cooked|Lentils, plain boiled|Pulses & beans|cooked lentils;plain dal
174284|masoor-dry|Red lentils, dry|Pulses & beans|masoor dal;pink lentils
172436|toor-dry|Pigeon peas, dry|Pulses & beans|toor dal;arhar dal;red gram
172437|toor-cooked|Pigeon peas, plain boiled|Pulses & beans|toor dal boiled;arhar cooked;red gram
174256|moong-dry|Mung beans, dry|Pulses & beans|moong dal;sabut moong;green gram
174257|moong-cooked|Mung beans, plain boiled|Pulses & beans|moong;green gram cooked
169957|moong-sprouts|Mung bean sprouts, raw|Pulses & beans|moong sprouts
169137|moong-sprouts-cooked|Mung bean sprouts, boiled|Pulses & beans|moong sprouts cooked
173756|chickpeas-dry|Chickpeas, dry|Pulses & beans|chana;chole;kabuli chana;garbanzo
173757|chickpeas-cooked|Chickpeas, plain boiled|Pulses & beans|chana;chole;kabuli chana;garbanzo
173800|chickpeas-canned|Chickpeas, canned and drained|Pulses & beans|canned chana;canned garbanzo
173744|kidney-dry|Red kidney beans, dry|Pulses & beans|rajma
175194|kidney-cooked|Red kidney beans, plain boiled|Pulses & beans|rajma;boiled rajma
174285|kidney-canned|Red kidney beans, canned and drained|Pulses & beans|canned rajma
173735|black-beans|Black beans, plain boiled|Pulses & beans|
173759|lobia-cooked|Black-eyed peas, plain boiled|Pulses & beans|lobia;chawli;cowpeas
173758|lobia-dry|Black-eyed peas, dry|Pulses & beans|dry lobia;chawli;cowpeas
172475|tofu|Tofu, firm, calcium-set|Pulses & beans|soya tofu;bean curd
171284|curd|Curd / dahi, plain whole-milk|Dairy & alternatives|curd;dahi;yogurt;plain yogurt
170886|curd-lowfat|Yogurt, plain low-fat|Dairy & alternatives|low fat dahi;low fat curd
170887|curd-skim|Yogurt, plain skim milk|Dairy & alternatives|skim dahi;nonfat curd
170894|greek-yogurt|Greek yogurt, plain nonfat|Dairy & alternatives|hung curd proxy
171265|milk-whole|Cow's milk, whole|Dairy & alternatives|whole milk;doodh
171267|milk-2|Cow's milk, 2% fat|Dairy & alternatives|reduced-fat milk;toned milk proxy
170872|milk-1|Cow's milk, 1% fat|Dairy & alternatives|low-fat milk
172182|cottage-cheese|Cottage cheese, 2% fat|Dairy & alternatives|cottage cheese
170859|cream|Heavy cream|Dairy & alternatives|malai proxy;whipping cream
173768|soy-milk|Soy milk, unsweetened light|Dairy & alternatives|soya milk
173424|egg-boiled|Egg, hard-boiled|Eggs|boiled egg;anda;andaa
171287|egg-raw|Egg, whole raw|Eggs|egg;anda
172185|egg-omelet|Egg, plain omelet reference|Eggs|omelette;omlet
172187|egg-scrambled|Egg, scrambled reference|Eggs|scrambled eggs
171477|chicken-breast|Chicken breast, roasted skinless|Meat & fish|chicken;grilled chicken breast
172388|chicken-thigh|Chicken thigh, roasted skinless|Meat & fish|chicken
172544|ground-lamb|Ground lamb, broiled|Meat & fish|lamb mince;lamb keema
175177|tilapia|Tilapia, dry-heat cooked|Meat & fish|fish;tilapia
175168|salmon|Atlantic salmon, dry-heat cooked|Meat & fish|fish;salmon
175120|mackerel|Atlantic mackerel, dry-heat cooked|Meat & fish|fish;mackerel
175139|sardines|Sardines in oil, canned and drained|Meat & fish|fish;sardine
173709|tuna|Light tuna in water, canned and drained|Meat & fish|fish;tuna
171971|shrimp|Shrimp, boiled|Meat & fish|prawn;jhinga
170440|potato-boiled|Potato, boiled without skin|Vegetables|aloo;alu;boiled potato
170026|potato-raw|Potato, raw with skin|Vegetables|aloo;raw potato
169986|cauliflower-raw|Cauliflower, raw|Vegetables|gobi;gobhi
170397|cauliflower|Cauliflower, boiled|Vegetables|gobi;gobhi
170419|peas-raw|Green peas, raw|Vegetables|matar;mutar
170420|peas|Green peas, boiled|Vegetables|matar;mutar
170000|onion|Onion, raw|Vegetables|pyaz;pyaaz
170457|tomato|Tomato, raw|Vegetables|tamatar
169230|garlic|Garlic, raw|Vegetables|lahsun;lehsun
169231|ginger|Ginger root, raw|Vegetables|adrak
170497|green-chili|Green hot chilli, raw|Vegetables|hari mirch;green chili
169997|cilantro|Coriander leaves, raw|Vegetables|cilantro;dhania;dhaniya
168462|spinach-raw|Spinach, raw|Vegetables|palak
168463|spinach-cooked|Spinach, boiled|Vegetables|palak
169260|okra-raw|Okra, raw|Vegetables|bhindi;ladyfinger
169261|okra-cooked|Okra, boiled|Vegetables|bhindi;ladyfinger
169228|eggplant-raw|Eggplant, raw|Vegetables|brinjal;baingan
169229|eggplant-cooked|Eggplant, boiled|Vegetables|brinjal;baingan
168448|pumpkin-raw|Pumpkin, raw|Vegetables|kaddu
168449|pumpkin-cooked|Pumpkin, boiled|Vegetables|kaddu
169975|cabbage-raw|Cabbage, raw|Vegetables|patta gobi;band gobhi
169976|cabbage-cooked|Cabbage, boiled|Vegetables|patta gobi;band gobhi
169961|green-beans-raw|Green beans, raw|Vegetables|french beans
169141|green-beans|Green beans, boiled|Vegetables|french beans
170393|carrots-raw|Carrot, raw|Vegetables|gajar
170394|carrots-cooked|Carrot, boiled|Vegetables|gajar
170379|broccoli-raw|Broccoli, raw|Vegetables|
169967|broccoli-cooked|Broccoli, boiled|Vegetables|
168409|cucumber|Cucumber, raw with skin|Vegetables|kheera;kakdi
169145|beet|Beetroot, raw|Vegetables|chukandar;beet
169146|beet-cooked|Beetroot, boiled|Vegetables|chukandar;beet
169998|corn-raw|Yellow sweet corn, raw|Vegetables|makka
169999|corn-cooked|Yellow sweet corn, boiled|Vegetables|makka;corn
168483|sweet-potato|Sweet potato, baked flesh|Vegetables|shakarkand
169251|mushroom|White mushroom, raw|Vegetables|button mushroom
169276|radish|Radish, raw|Vegetables|mooli
170465|turnip|Turnip, raw|Vegetables|shalgam
171688|apple|Apple, with skin|Fruit|seb
173944|banana|Banana, peeled|Fruit|kela
169910|mango|Mango, flesh|Fruit|aam
169097|orange|Orange, peeled|Fruit|santra;naranja
173044|guava|Guava|Fruit|amrud;amrood
169926|papaya|Papaya|Fruit|papita
169134|pomegranate|Pomegranate arils|Fruit|anar;anaar
169124|pineapple|Pineapple|Fruit|ananas
167765|watermelon|Watermelon|Fruit|tarbooz
174683|grapes|Grapes|Fruit|angoor
169092|muskmelon|Muskmelon, cantaloupe|Fruit|kharbuja;kharbooja
169118|pear|Pear|Fruit|nashpati
167762|strawberries|Strawberries|Fruit|
169928|peach|Peach|Fruit|aadoo
168191|dates|Medjool dates|Fruit|khajoor
167763|tamarind|Tamarind|Fruit|imli
167747|lemon-juice|Lemon juice, fresh|Fruit|nimbu;nimbu juice
168155|lime|Lime|Fruit|nimbu
170567|almonds|Almonds|Nuts & seeds|badam
170162|cashews|Cashews, raw|Nuts & seeds|kaju
170187|walnuts|English walnuts|Nuts & seeds|akhrot
170184|pistachios|Pistachios, raw|Nuts & seeds|pista
172430|peanuts|Peanuts, raw|Nuts & seeds|moongfali;groundnut
172470|peanut-butter|Peanut butter, unsalted|Nuts & seeds|groundnut butter
170150|sesame|Sesame seeds, whole|Nuts & seeds|til
170554|chia|Chia seeds|Nuts & seeds|
169414|flax|Flaxseed|Nuts & seeds|alsi
170169|coconut|Coconut meat, raw|Nuts & seeds|nariyal
170173|coconut-milk|Coconut milk, canned|Dairy & alternatives|nariyal milk
173412|ghee|Ghee / clarified butter reference|Oils & seasonings|ghee;butter oil
172336|canola-oil|Canola oil|Oils & seasonings|neutral oil
172337|mustard-oil|Mustard oil|Oils & seasonings|sarson tel
171410|peanut-oil|Peanut oil|Oils & seasonings|groundnut oil
171412|coconut-oil|Coconut oil|Oils & seasonings|nariyal tel
171413|olive-oil|Olive oil|Oils & seasonings|
171016|sesame-oil|Sesame oil|Oils & seasonings|til tel
171025|sunflower-oil|Sunflower oil|Oils & seasonings|
169655|sugar|Granulated white sugar|Oils & seasonings|chini;cheeni
169640|honey|Honey|Oils & seasonings|shahad
173468|salt|Table salt|Oils & seasonings|namak;salt
170923|cumin|Cumin seed|Oils & seasonings|jeera;zira
172231|turmeric|Ground turmeric|Oils & seasonings|haldi
170922|coriander-seed|Coriander seed|Oils & seasonings|dhania seed
170919|cardamom|Cardamom, edible spice|Oils & seasonings|elaichi
170929|mustard-seed|Ground mustard seed|Oils & seasonings|rai;sarson
171320|cinnamon|Ground cinnamon|Oils & seasonings|dalchini
171323|fennel|Fennel seed|Oils & seasonings|saunf
170924|curry-powder|Curry powder|Oils & seasonings|curry spice blend
173227|tea-black|Black tea, brewed, unsweetened|Drinks|plain tea;kali chai
171890|coffee-black|Black coffee, brewed|Drinks|coffee without milk
174158|water|Plain drinking water|Drinks|pani
168393|bitter-gourd-raw|Bitter gourd, raw pods|Vegetables|karela;karavila;bitter melon
168394|bitter-gourd-cooked|Bitter gourd, boiled pods|Vegetables|karela;karavila;bitter melon
168414|sponge-gourd-raw|Sponge gourd, raw|Vegetables|tori;turai;nenua;towelgourd;dishcloth gourd
168415|sponge-gourd-cooked|Sponge gourd, boiled|Vegetables|tori;turai;nenua;dishcloth gourd
169232|bottle-gourd-raw|Bottle gourd, raw|Vegetables|lauki;ghiya;dudhi;sorakkai;calabash
169233|bottle-gourd-cooked|Bottle gourd, boiled|Vegetables|lauki;ghiya;dudhi;sorakkai;calabash
170069|ash-gourd-raw|Ash gourd, raw|Vegetables|petha;winter melon;white pumpkin
170475|ash-gourd-cooked|Ash gourd, boiled|Vegetables|petha;winter melon;white pumpkin
170402|chayote-raw|Chayote, raw|Vegetables|chow chow;choko;iskus
170403|chayote-cooked|Chayote, boiled|Vegetables|chow chow;choko;iskus
168416|moringa-leaves-raw|Moringa leaves, raw|Vegetables|drumstick leaves;sahjan leaves;moringa saag
168417|moringa-leaves-cooked|Moringa leaves, boiled|Vegetables|drumstick leaves;sahjan leaves;moringa saag
170483|drumstick-raw|Drumstick pods, raw|Vegetables|moringa pods;sahjan;singhi;murungakkai
170484|drumstick-cooked|Drumstick pods, boiled|Vegetables|moringa pods;sahjan;singhi;murungakkai
168385|amaranth-leaves-raw|Amaranth leaves, raw|Vegetables|chaulai saag;lal saag
169202|amaranth-leaves-cooked|Amaranth leaves, boiled|Vegetables|chaulai saag;lal saag
169256|mustard-greens-raw|Mustard greens, raw|Vegetables|sarson saag;sarson leaves
169257|mustard-greens-cooked|Mustard greens, plain boiled|Vegetables|sarson saag;sarson leaves
169244|lambsquarters|Lambsquarters, raw|Vegetables|bathua;bathua saag
169250|lotus-root-raw|Lotus root, raw|Vegetables|kamal kakdi;bhein;nadru
168430|lotus-root-cooked|Lotus root, boiled|Vegetables|kamal kakdi;bhein;nadru
169308|taro-raw|Taro root, raw|Vegetables|arbi;arvi;colocasia root
168486|taro-cooked|Taro root, cooked|Vegetables|arbi;arvi;colocasia root
168488|taro-leaves-cooked|Taro leaves, steamed|Vegetables|arbi leaves;patra leaves;colocasia leaves
170071|yam-raw|Yam, raw|Vegetables|yam
170072|yam-cooked|Yam, boiled or baked|Vegetables|yam
169985|cassava-raw|Cassava root, raw|Vegetables|tapioca root;kappa;maravalli
168490|arrowroot-raw|Arrowroot, raw|Vegetables|ararot;koova
168482|sweet-potato-raw|Sweet potato, raw|Vegetables|shakarkand
168215|green-plantain-raw|Green plantain, raw|Vegetables|raw banana;kaccha kela;vazhakkai
168216|green-plantain-cooked|Green plantain, boiled|Vegetables|raw banana boiled;kaccha kela;vazhakkai
169210|bamboo-shoots-raw|Bamboo shoots, raw|Vegetables|baans;karil
169211|bamboo-shoots-cooked|Bamboo shoots, boiled|Vegetables|baans;karil
168580|oyster-mushroom|Oyster mushrooms, raw|Vegetables|oyster mushroom
169242|shiitake|Shiitake mushrooms, raw|Vegetables|shiitake mushroom
169255|portobello|Portobello mushrooms, raw|Vegetables|portabella mushroom
169291|zucchini|Zucchini, raw|Vegetables|courgette
169295|butternut-raw|Butternut squash, raw|Vegetables|butternut pumpkin
169296|butternut-cooked|Butternut squash, baked|Vegetables|butternut pumpkin
170108|red-capsicum|Red capsicum, raw|Vegetables|red bell pepper;lal shimla mirch
170427|green-capsicum|Green capsicum, raw|Vegetables|green bell pepper;shimla mirch
169383|yellow-capsicum|Yellow capsicum, raw|Vegetables|yellow bell pepper;peeli shimla mirch
170005|spring-onion|Spring onions, raw|Vegetables|scallion;hara pyaz
170499|shallot|Shallots, raw|Vegetables|small onions;sambar onion
169988|celery|Celery, raw|Vegetables|
170068|watercress|Watercress, raw|Vegetables|
168421|kale|Kale, raw|Vegetables|
169238|kale-cooked|Kale, boiled|Vegetables|
168389|asparagus|Asparagus, raw|Vegetables|
168390|asparagus-cooked|Asparagus, boiled|Vegetables|
170416|parsley|Parsley, fresh|Vegetables|
173475|mint|Spearmint, fresh|Vegetables|pudina;mint leaves
172233|dill|Dill, fresh|Vegetables|suva;shepu;sowa
172232|basil|Sweet basil, fresh|Vegetables|basil
167759|sapodilla|Sapodilla|Fruit|chikoo;chiku;sapota
168175|sugar-apple|Sugar apple|Fruit|sitaphal;custard apple;sharifa;seethaphal
171725|bullocks-heart|Bullock's-heart custard apple|Fruit|ramphal;custard apple
174687|jackfruit-ripe|Jackfruit, ripe raw flesh|Fruit|kathal;chakka;phanas
171714|breadfruit|Breadfruit, raw|Fruit|bread fruit
173043|cape-gooseberry|Cape gooseberry|Fruit|rasbhari;goldenberry
173030|gooseberries|Gooseberry, European type|Fruit|gooseberry
169089|longan|Longan, raw|Fruit|
169913|mulberry|Mulberries, raw|Fruit|shahtoot;shah toot
169949|plum|Plums, raw|Fruit|aloo bukhara
168153|kiwi|Kiwi fruit, green|Fruit|
168177|asian-pear|Asian pear|Fruit|nashi;nashpati
171705|avocado|Avocado, flesh|Fruit|butter fruit;makhanphal
171711|blueberries|Blueberries, raw|Fruit|
167755|raspberries|Raspberries, raw|Fruit|
173946|blackberries|Blackberries, raw|Fruit|
174673|grapefruit|Grapefruit, pink or red|Fruit|
173021|fig|Figs, fresh|Fruit|anjeer
174665|fig-dried|Figs, dried|Fruit|dry anjeer
168165|raisins|Raisins, dark seedless|Fruit|kishmish
168164|golden-raisins|Raisins, golden seedless|Fruit|golden kishmish
171726|dates-deglet|Dates, Deglet Noor|Fruit|khajoor
173941|apricot-dried|Apricots, dried|Fruit|khubani;jardalu
171697|apricot|Apricots, fresh|Fruit|khubani;jardalu
169130|plantain-ripe|Yellow plantain, raw|Fruit|ripe plantain
169131|plantain-baked|Yellow plantain, baked|Fruit|ripe plantain
170174|coconut-water|Coconut water, fresh|Drinks|nariyal pani;tender coconut water
168897|wild-rice-cooked|Wild rice, cooked|Grains & breads|
169726|wild-rice-raw|Wild rice, dry|Grains & breads|
168930|rice-medium-cooked|Medium-grain white rice, cooked|Grains & breads|white rice;medium grain chawal
169760|rice-medium-raw|Medium-grain white rice, dry|Grains & breads|white rice;medium grain chawal
168932|rice-short-cooked|Short-grain white rice, cooked|Grains & breads|white rice;short grain chawal
168931|rice-short-raw|Short-grain white rice, dry|Grains & breads|white rice;short grain chawal
170284|barley-dry|Pearled barley, dry|Grains & breads|jau;jao
170285|barley-cooked|Pearled barley, cooked|Grains & breads|jau;jao
168890|whole-wheat-berries|Whole wheat grain, dry|Grains & breads|gehun;wheat berries
170688|bulgur-dry|Bulgur wheat, dry|Grains & breads|broken wheat proxy;dalia proxy
170287|bulgur-cooked|Bulgur wheat, cooked|Grains & breads|broken wheat proxy;dalia proxy
170290|makki-atta|Whole yellow corn flour|Grains & breads|makki atta;makke ka atta;maize flour
169697|cornmeal|Whole yellow cornmeal|Grains & breads|maize meal
169741|oat-flour|Oat flour, partially debranned|Grains & breads|oats flour
170684|arrowroot-flour|Arrowroot flour|Grains & breads|ararot flour
168928|pasta-cooked|Plain pasta, cooked|Grains & breads|macaroni;pasta
172688|bread-whole-wheat|Whole-wheat bread|Grains & breads|brown bread;atta bread
174924|bread-white|White sandwich bread|Grains & breads|bread;white bread
174916|whole-wheat-pita|Whole-wheat pita|Grains & breads|
174075|roti-whole-wheat-frozen|Whole-wheat roti, commercial frozen|Grains & breads|frozen chapati;frozen roti
174076|paratha-frozen|Whole-wheat paratha, commercial frozen|Grains & breads|frozen paratha
174077|naan-whole-wheat|Whole-wheat naan, commercial|Grains & breads|atta naan
172429|split-peas-cooked|Split peas, plain boiled|Pulses & beans|split matar;boiled matar dal
173734|black-beans-dry|Black beans, dry|Pulses & beans|
175200|pinto-beans-cooked|Pinto beans, plain boiled|Pulses & beans|
175199|pinto-beans-dry|Pinto beans, dry|Pulses & beans|
173746|navy-beans-cooked|White navy beans, plain boiled|Pulses & beans|white beans
173745|navy-beans-dry|White navy beans, dry|Pulses & beans|white beans
174253|lima-beans-cooked|Mature lima beans, plain boiled|Pulses & beans|butter beans
174252|lima-beans-dry|Mature lima beans, dry|Pulses & beans|butter beans
169135|fresh-lima-beans-cooked|Young lima beans, plain boiled|Pulses & beans|
172453|winged-beans-cooked|Mature winged beans, plain boiled|Pulses & beans|
174283|winged-beans-dry|Mature winged beans, dry|Pulses & beans|
174270|soybeans-dry|Soybeans, dry|Pulses & beans|soyabean;soya bean
174300|soybeans-roasted|Soybeans, roasted unsalted|Pulses & beans|roasted soy nuts
168411|edamame|Edamame, cooked|Pulses & beans|green soybeans
168427|lentil-sprouts|Lentil sprouts, raw|Pulses & beans|sprouted masoor
168428|lentil-sprouts-cooked|Lentil sprouts, cooked|Pulses & beans|sprouted masoor
174275|soy-flour|Soy flour, defatted|Pulses & beans|soya flour
172467|tempeh|Tempeh, cooked|Pulses & beans|
172449|tofu-soft|Soft tofu|Pulses & beans|soft bean curd
174304|tofu-fried|Fried tofu, calcium-set|Pulses & beans|fried bean curd
172454|hummus|Hummus, home prepared reference|Pulses & beans|chickpea dip
171280|buffalo-milk|Buffalo milk, USDA reference|Dairy & alternatives|buffalo doodh;bhains ka doodh
171278|goat-milk|Goat milk, vitamin D fortified|Dairy & alternatives|goat doodh;bakri ka doodh
171269|milk-skim-fortified|Skim milk, A and D fortified|Dairy & alternatives|fat-free milk;nonfat milk
170874|buttermilk-cultured|Cultured buttermilk, low-fat|Dairy & alternatives|cultured buttermilk
171304|greek-yogurt-whole|Greek yogurt, plain whole milk|Dairy & alternatives|greek curd;greek yogurt
170903|greek-yogurt-lowfat|Greek yogurt, plain low-fat|Dairy & alternatives|greek yogurt
170845|mozzarella|Mozzarella, whole milk|Dairy & alternatives|
170851|ricotta|Ricotta, whole milk|Dairy & alternatives|
173414|cheddar|Cheddar|Dairy & alternatives|
173420|feta|Feta|Dairy & alternatives|
173410|butter-salted|Salted butter|Oils & seasonings|namkeen makhan
173430|butter-unsalted|Unsalted butter|Oils & seasonings|white makhan;unsalted makhan
172183|egg-white|Egg white, raw|Eggs|egg whites;anda white
172184|egg-yolk|Egg yolk, raw|Eggs|anda yolk
172189|duck-egg|Duck egg, raw|Eggs|
172191|quail-egg|Quail egg, raw|Eggs|bater anda
171075|chicken-breast-skin|Chicken breast, roasted with skin|Meat & fish|roasted chicken
173612|chicken-drumstick|Chicken drumstick, roasted with skin|Meat & fish|chicken leg
173625|chicken-thigh-skin|Chicken thigh, roasted with skin|Meat & fish|roasted chicken
173630|chicken-wing|Chicken wings, roasted with skin|Meat & fish|roasted wings
171116|ground-chicken|Ground chicken, raw|Meat & fish|chicken keema
172851|ground-turkey|Ground turkey, cooked, 93% lean|Meat & fish|turkey keema
171956|cod|Atlantic cod, dry-heat cooked|Meat & fish|fish;cod
173718|trout|Rainbow trout, dry-heat cooked|Meat & fish|fish;trout
174185|carp|Carp, dry-heat cooked|Meat & fish|fish;generic carp
173683|pompano|Florida pompano, dry-heat cooked|Meat & fish|fish;pompano
173699|snapper|Snapper, dry-heat cooked|Meat & fish|fish;snapper
175124|mullet|Mullet, dry-heat cooked|Meat & fish|fish;mullet
175166|catfish|Channel catfish, dry-heat cooked|Meat & fish|fish;catfish
174183|anchovy|Anchovy in oil, drained|Meat & fish|anchovy
174205|blue-crab|Blue crab, cooked|Meat & fish|crab;kekda
171982|squid-fried|Squid, fried|Meat & fish|calamari
170163|cashew-butter|Cashew butter, unsalted|Nuts & seeds|kaju butter
170182|pecans|Pecans, raw|Nuts & seeds|
170581|hazelnuts|Hazelnuts, raw|Nuts & seeds|
170569|brazil-nuts|Brazil nuts, dried|Nuts & seeds|
170556|pumpkin-seeds|Pumpkin seed kernels, dried|Nuts & seeds|kaddu seeds;pepitas
170562|sunflower-seeds|Sunflower seed kernels, dried|Nuts & seeds|surajmukhi seeds
170149|lotus-seeds-dried|Lotus seeds, dried|Nuts & seeds|kamal seeds;lotus nuts
170931|black-pepper|Black pepper|Oils & seasonings|kali mirch
170932|cayenne|Cayenne pepper|Oils & seasonings|lal mirch proxy
170917|bay-leaf|Bay leaf, dried|Oils & seasonings|bay leaf
170934|saffron|Saffron|Oils & seasonings|kesar
171321|cloves|Ground cloves|Oils & seasonings|laung;lavang
171324|fenugreek-seed|Fenugreek seed|Oils & seasonings|methi dana;vendhayam
171326|nutmeg|Ground nutmeg|Oils & seasonings|jaiphal
171329|paprika|Paprika|Oils & seasonings|
171330|poppy-seeds|Poppy seeds|Oils & seasonings|khus khus;posto
174277|soy-sauce|Soy sauce, standard|Oils & seasonings|soya sauce;shoyu
172473|soy-sauce-low-sodium|Soy sauce, reduced sodium|Oils & seasonings|soya sauce
172237|vinegar|Distilled vinegar|Oils & seasonings|sirka
168820|molasses|Molasses|Oils & seasonings|
169661|maple-syrup|Maple syrup|Oils & seasonings|
170687|buckwheat-flour|Buckwheat flour|Grains & breads|kuttu ka atta;kuttu flour
170686|buckwheat-cooked|Buckwheat groats, cooked|Grains & breads|kuttu groats
169758|parboiled-rice-dry|Parboiled rice, dry|Grains & breads|usna chawal
174271|soybeans-cooked|Soybeans, plain boiled|Pulses & beans|soya beans cooked;soyabean
171325|garlic-powder|Garlic powder|Oils & seasonings|lahsun powder
175040|baking-soda|Baking soda|Oils & seasonings|sodium bicarbonate;meetha soda"""

fndds = """2705740|paneer|Paneer|Dairy & alternatives|paneer;panir
2706490|biryani-meat|Meat biryani, survey reference|Indian dishes|biryani;mutton biryani
2706538|biryani-chicken|Chicken biryani, survey reference|Indian dishes|biryani
2708985|biryani-veg|Vegetable biryani, survey reference|Indian dishes|veg biryani;biryani
2707427|dal-reference|Dal, survey reference|Indian dishes|dal;dahl;daal
2707431|lentil-curry|Lentil curry, survey reference|Indian dishes|dal curry
2707432|lentil-curry-rice|Lentil curry with rice, survey reference|Indian dishes|dal chawal;dal rice
2707429|papad|Papad, grilled or broiled|Snacks|papad;papadam;poppadom
2707613|naan|Naan, survey reference|Grains & breads|naan;nan
2707713|roti-reference|Roti / chapati, survey reference|Grains & breads|chappati;chapatti;chapati;roti
2707715|paratha|Paratha, survey reference|Grains & breads|parantha;parotta
2708346|idli|Idli, survey reference|Indian dishes|idli;idly
2708347|dosa|Plain dosa, survey reference|Indian dishes|dosa;dosai;sada dosa
2709129|dosa-filled|Dosa with filling, survey reference|Indian dishes|masala dosa;dosa
2708730|samosa|Samosa, survey reference|Snacks|samosa;singara
2709631|palak-paneer|Palak paneer, survey reference|Indian dishes|palak paneer;saag paneer
2710351|ladoo|Ladoo, survey reference|Snacks|laddu;laddoo
2710066|pakora|Pakora, survey reference|Snacks|pakoda;bhajiya;bhajia
2710067|sabzi-reference|Vegetable curry, survey reference|Indian dishes|veg curry;sabzi;subzi
2710068|vegetable-curry-rice|Vegetable curry with rice, survey reference|Indian dishes|veg curry with rice
2706437|chicken-curry|Chicken curry, survey reference|Indian dishes|murgh curry
2706438|chicken-curry-rice|Chicken curry with rice, survey reference|Indian dishes|chicken curry rice
2706460|fish-curry|Fish curry, survey reference|Indian dishes|fish curry;machli curry
2709309|chutney|Chutney, survey reference|Indian dishes|chutney
2710506|tea-milk-reference|Hot tea with milk, survey reference|Drinks|milk tea;chai
2709947|okra-fat|Okra cooked with added fat, survey reference|Vegetables|bhindi;okra
2710054|okra-fried|Fried okra, survey reference|Vegetables|fried bhindi;kurkuri bhindi
2705686|phirni|Phirni, survey reference|Indian dishes|firni;ferni;rice pudding
2705700|barfi|Barfi, survey reference|Snacks|burfi;barfee;mithai
2707451|soya-chunks-dry|Textured vegetable protein, dry|Pulses & beans|soya chunks proxy;soy chunks proxy;soya nuggets;soy granules;tvp
2710568|tamarind-drink|Tamarind drink, survey reference|Drinks|imli drink;tamarind agua fresca
2708352|noodles-cooked|Noodles, plain cooked|Grains & breads|boiled noodles
2708356|rice-noodles|Rice noodles, cooked|Grains & breads|boiled rice noodles
2708404|rice-oil|White rice cooked with oil, survey reference|Grains & breads|rice with oil
2708615|cheese-pizza-thin|Cheese pizza, thin crust restaurant reference|Indian dishes|cheese pizza;zomato pizza;delivery pizza
2706461|fish-curry-rice|Fish curry with rice, survey reference|Indian dishes|machli curry rice"""

keys = {
 '1008':'kcal','1003':'protein','1005':'carbs','1004':'fat','1079':'fiber','2000':'sugar',
 '1258':'saturatedFat','1093':'sodium','1087':'calcium','1089':'iron','1092':'potassium','1162':'vitaminC',
 '1178':'vitaminB12','1190':'folate','1090':'magnesium','1095':'zinc','1114':'vitaminD','1235':'addedSugar',
}
legacy_keys = {
 '208':'kcal','203':'protein','205':'carbs','204':'fat','291':'fiber','269':'sugar',
 '606':'saturatedFat','307':'sodium','301':'calcium','303':'iron','306':'potassium','401':'vitaminC',
 '418':'vitaminB12','435':'folate','304':'magnesium','309':'zinc','328':'vitaminD','539':'addedSugar',
}
with_portions = {
 'rice-cooked': [('katori (150 g, estimate)',150)], 'brown-rice-cooked': [('katori (150 g, estimate)',150)],
 'chickpeas-cooked': [('katori (150 g, estimate)',150)], 'lentils-cooked': [('katori (150 g, estimate)',150)],
 'moong-cooked': [('katori (150 g, estimate)',150)], 'toor-cooked': [('katori (150 g, estimate)',150)],
 'kidney-cooked': [('katori (150 g, estimate)',150)], 'curd': [('small katori (100 g, estimate)',100)],
 'curd-lowfat': [('small katori (100 g, estimate)',100)], 'curd-skim': [('small katori (100 g, estimate)',100)],
 'ghee': [('tsp (4.5 g, estimate)',4.5)], 'mustard-oil': [('tsp (4.5 g, estimate)',4.5)],
 'canola-oil': [('tsp (4.5 g, estimate)',4.5)], 'peanut-oil': [('tsp (4.5 g, estimate)',4.5)],
 'salt': [('tsp (6 g, estimate)',6)], 'sugar': [('tsp (4 g, estimate)',4)],
 'soya-chunks-dry': [('dry portion (25 g)',25)],
 'dal-reference': [('katori (150 g, estimate)',150)], 'sabzi-reference': [('katori (125 g, estimate)',125)],
 'palak-paneer': [('katori (150 g, estimate)',150)],
}
notes = {
 'rice-cooked':'Unenriched long-grain white rice, cooked without salt. A generic proxy for plain basmati. Cooked weight changes with water.',
 'rice-dry':'Unenriched long-grain white rice, weighed dry. A generic proxy for dry basmati.',
 'atta':'USDA whole-grain wheat flour used as an atta proxy. Flour type and milling vary.',
 'curd':'Plain whole-milk yogurt used as a proxy for unsweetened cow’s-milk dahi. Use your package label for exact brand values or for buffalo-milk or strained dahi.',
 'curd-lowfat':'Use your package label for exact fat and protein values.',
 'greek-yogurt':'Nonfat Greek yogurt can differ substantially from home-strained dahi.',
 'milk-2':'Generic 2% cow’s milk. Use the package label for toned milk if the fat or solids differ.',
 'cream':'Heavy whipping cream is a proxy. Fresh malai can have a different fat content.',
 'ghee':'USDA anhydrous butter oil is a proxy for ghee.',
 'soya-chunks-dry':'Dry textured vegetable protein is a proxy for unflavoured soya chunks. Use the package label if its macros differ; weigh before soaking.',
 'paneer':'Generic paneer. Milk type, moisture and fat content vary by batch and brand.',
 'chai':'Brewed black tea and whole cow’s milk with sugar. No edible spices counted. If you use 2 tsp sugar, add an extra 4 g sugar.',
 'tea-black':'Brewed with tap water. Approximate 1 g/mL for volume units.',
 'coffee-black':'Brewed with tap water. Approximate 1 g/mL for volume units.',
 'water':'Mineral values are for the generic USDA bottled water reference. Approximate 1 g/mL.',
}
data = {}

def rows(archive, stem):
    entry = next(n for n in archive.namelist() if n.endswith('/'+stem+'.csv'))
    with archive.open(entry) as item, io.TextIOWrapper(item, encoding='utf-8-sig') as stream:
        yield from csv.DictReader(stream)

def read_dataset(tag, selection):
    with zipfile.ZipFile(archives[tag]) as archive:
        selected = {}
        for line in selection.splitlines():
            if not line or line.startswith('#'):
                continue
            food_id, *record = line.split('|')
            if food_id in selected:
                raise ValueError(f'Duplicate USDA food ID {food_id}')
            selected[food_id] = record
        catalog = {row['fdc_id']:row['description'] for row in rows(archive,'food') if row['fdc_id'] in selected}
        if catalog.keys() != selected.keys():
            raise ValueError(f'Missing food IDs {selected.keys() - catalog.keys()}')
        nutrients = collections.defaultdict(dict)
        for row in rows(archive,'food_nutrient'):
            food_id = row['fdc_id']
            name = keys.get(row['nutrient_id']) or legacy_keys.get(row['nutrient_id'])
            if food_id not in catalog or not name or not row['amount']:
                continue
            amount = float(row['amount'])
            if name in nutrients[food_id] and nutrients[food_id][name] != amount:
                raise ValueError(f'Duplicate nutrient {food_id} {name}')
            nutrients[food_id][name] = amount

        dataset_portions = collections.defaultdict(list)
        for row in rows(archive,'food_portion'):
            food_id = row['fdc_id']
            if food_id not in catalog or not row['gram_weight']:
                continue
            portion = row['portion_description'] or row['modifier']
            if re.match(r'^(quantity|guide|ns as|additional|not specified)',portion,re.I):
                continue
            if tag == 'sr-legacy':
                if float(row['amount'] or 0) != 1:
                    continue
                if not re.match(r'^(cup|tbsp|tsp|large|medium|piece|clove|fruit|slice|egg|chapati|naan|serving|date|wedge)\b',portion,re.I):
                    continue
            else:
                portion = re.sub(r'^1\s+', '',portion)
                if not re.match(r'^(cup|tbsp|tsp|large|medium|piece|slice|egg|chapatti|paratha|idli|dosa|samosa|ball|roti|papad|pakora|naan)\b',portion,re.I):
                    continue
            weight = float(row['gram_weight'])
            if weight > 0:
                dataset_portions[food_id].append((f'{portion} ({weight:g} g, USDA)',weight))

        for food_id, (ident, name, category, aliases) in selected.items():
            if ident in data:
                raise ValueError(f'Duplicate catalog ID {ident}')
            if not {'kcal', 'protein', 'carbs', 'fat'} <= nutrients[food_id].keys():
                raise ValueError(f'Missing core nutrients: {ident}')
            basis = 'ml' if ident in ('tea-black','coffee-black','water') else 'g'
            portions = list(with_portions.get(ident, []))
            if basis == 'ml':
                portions += [('cup (150 mL)',150),('mug (240 mL)',240)]
            else:
                portions += dataset_portions[food_id][:3]
            out = dict(id=ident,name=name,category=category,basis=basis,nutrients=nutrients[food_id])
            if aliases:
                out['aliases'] = aliases.split(';')
            if portions:
                out['portions'] = [dict(label=label,amount=amount) for label,amount in portions]
            description = catalog[food_id]
            label = 'USDA FoodData Central · SR Legacy' if tag == 'sr-legacy' else 'USDA FoodData Central · FNDDS survey estimate'
            source_note = notes.get(ident)
            if tag == 'fndds':
                source_note = (source_note or 'A standard US survey food. Your ingredients, preparation and portions can differ.')
            out['source'] = dict(label=label,url=f'https://fdc.nal.usda.gov/food-search/?query={food_id}',note=f'USDA FDC {food_id}: {description}.'+(f' {source_note}' if source_note else ''))
            data[ident] = out

read_dataset('sr-legacy',sr)
read_dataset('fndds',fndds)
data['banana']['portions'].sort(key=lambda portion: not portion['label'].startswith('medium'))
data['egg-boiled']['portions'].insert(0,dict(label='large egg (50 g, edible)',amount=50))
data['roti-reference'].setdefault('portions',[]).append(dict(label='medium roti (40 g, estimate)',amount=40))
data['paneer'].setdefault('portions',[]).append(dict(label='50 g portion',amount=50))

def add_recipe(ident, name, aliases, category, basis, yield_amount, ingredients, portions, detail, *, added_sugar=None, reference=None):
    assert yield_amount > 0 and all(key in data and amount > 0 for key,amount in ingredients)
    if ident in data:
        raise ValueError(f'Duplicate recipe {ident}')
    estimates = {}
    for nutrient in keys.values():
        if all(nutrient in data[key]['nutrients'] for key,_ in ingredients):
            estimates[nutrient] = round(math.fsum(data[key]['nutrients'][nutrient] * amount for key,amount in ingredients)/yield_amount, 4)
    if added_sugar is not None:
        estimates['addedSugar'] = round(added_sugar * 100 / yield_amount, 4)
    if not {'kcal', 'protein', 'carbs', 'fat'} <= estimates.keys():
        raise ValueError(f'Missing core nutrient in {ident}: {estimates}')
    assumption = ', '.join(f"{amount:g} {data[key]['basis']} {data[key]['name']}" for key, amount in ingredients)
    label = ('Modeled home recipe · USDA ingredients' if all(
        data[key]['source']['label'].startswith(('USDA', 'Modeled home recipe')) for key,_ in ingredients
    ) else 'Modeled home recipe · USDA and package values')
    source = dict(label=label, url='https://fdc.nal.usda.gov/download-datasets/',
                  note=f'{detail} Modeled batch: {assumption}. Finished yield: {yield_amount:g} {basis}.')
    if reference:
        source['url'] = reference
        source['note'] += ' Linked recipe gives preparation context. The app estimate uses the listed batch and USDA ingredient values.'
    if label.endswith('package values'):
        source['note'] += ' Package values are cited on the individual ingredient entries.'
    data[ident] = dict(id=ident,name=name,aliases=aliases.split(';'),category=category,basis=basis,nutrients=estimates,
                       portions=[dict(label=label,amount=amount) for label,amount in portions],
                       source=source,recipe=[dict(id=key,amount=amount) for key,amount in ingredients])

add_recipe('roti','Roti / chapati, homemade plain','roti;chapati;chappati;chapatti;phulka;rotli','Grains & breads','g',40,
           [('atta',30),('water',10)],[('piece (40 g, estimate)',40)],
           'One roti made with 30 g dry atta and water. Estimated cooked weight; no oil or ghee included. Add any topping separately.')
add_recipe('roti-ghee','Roti / chapati with ghee','ghee roti;chapati with ghee;phulka with ghee','Grains & breads','g',44.5,
           [('roti',40),('ghee',4.5)],[('piece (44.5 g, estimate)',44.5)],
           'One medium roti brushed with about 1 teaspoon of ghee.')
add_recipe('dal','Toor dal tadka, homemade','dal;daal;dahl;toor dal;arhar dal;tadka dal','Indian dishes','g',300,
           [('toor-cooked',200),('onion',30),('tomato',40),('canola-oil',5),('cumin',1),('water',25),('salt',1)],
           [('katori (150 g, estimate)',150),('cup (240 g, estimate)',240)],
           'Thin-to-medium toor dal with about 2.5 g oil and 0.5 g salt per katori. A thicker dal or larger tadka changes the result.')
add_recipe('sabzi','Aloo gobi matar sabzi, homemade','sabzi;subzi;sabji;aloo gobi;aloo gobhi;potato cauliflower peas;mixed veg','Indian dishes','g',400,
           [('potato-boiled',130),('cauliflower',140),('peas',70),('tomato',50),('canola-oil',10),('cumin',1),('salt',1.5)],
           [('katori (125 g, estimate)',125)],
           'Dry potato, cauliflower and pea sabzi. About 3.1 g oil per katori; other vegetables and oil levels change the result.')
add_recipe('chai','Milk chai, homemade (1 tsp sugar)','chai;tea;milk tea;doodh chai;sweet chai;masala chai','Drinks','ml',150,
           [('tea-black',90),('milk-whole',62),('sugar',4)],[('cup (150 mL)',150),('mug (240 mL)',240)],
           'A 150 mL cup modeled as 90 mL brewed black tea, about 60 mL whole milk and one level teaspoon of sugar. Strained spices are omitted.', added_sugar=4)
add_recipe('chai-no-sugar','Milk chai, homemade (no added sugar)','unsweetened chai;no sugar chai;milk tea no sugar','Drinks','ml',150,
           [('tea-black',90),('milk-whole',62)],[('cup (150 mL)',150),('mug (240 mL)',240)],
           'A 150 mL cup made with about 60 mL whole milk. Includes naturally occurring milk sugar.', added_sugar=0)
add_recipe('rajma','Rajma masala, homemade','rajma;rajma curry;kidney bean curry','Indian dishes','g',410,
           [('kidney-cooked',260),('onion',40),('tomato',80),('ginger',5),('garlic',6),('canola-oil',8),('cumin',1),('salt',2),('water',25)],
           [('katori (150 g, estimate)',150)],
           'Red kidney beans simmered in a tomato-onion gravy. Oil and salt are measured for the batch.')
add_recipe('chole','Chana masala / chole, homemade','chana;chole;chana masala;chickpea curry','Indian dishes','g',410,
           [('chickpeas-cooked',260),('onion',40),('tomato',80),('ginger',5),('garlic',6),('canola-oil',8),('cumin',1),('salt',2),('water',25)],
           [('katori (150 g, estimate)',150)],
           'Cooked chickpeas simmered in a tomato-onion gravy. Oil and salt are measured for the batch.')
add_recipe('khichdi','Moong dal khichdi, homemade','khichdi;khichari;khichuri;moong khichdi;kichdi','Indian dishes','g',420,
           [('rice-cooked',200),('moong-cooked',130),('ghee',5),('cumin',1),('turmeric',0.5),('water',85),('salt',1.5)],
           [('katori (150 g, estimate)',150)],
           'Rice and whole mung bean proxy with ghee and water. Split moong, moisture and the rice-to-dal ratio affect the result.')
add_recipe('lassi','Sweet lassi, homemade','lassi;dahi drink;sweet lassi','Drinks','ml',220,
           [('curd',150),('water',65),('sugar',8)],[('glass (220 mL)',220)],
           'Blended whole-milk dahi with two level teaspoons of sugar per glass.', added_sugar=8)
add_recipe('raita','Cucumber raita, homemade','raita;kheera raita;cucumber curd','Indian dishes','g',220,
           [('curd',160),('cucumber',60),('cumin',1),('salt',0.8)],[('small katori (100 g, estimate)',100)],
           'Unsweetened whole-milk dahi with cucumber, cumin and salt.')
add_recipe('bhindi-sabzi','Bhindi sabzi, homemade','bhindi;okra sabzi;bhindi masala;sabzi','Indian dishes','g',280,
           [('okra-raw',240),('onion',55),('tomato',40),('canola-oil',10),('cumin',1),('salt',1.5)],
           [('katori (125 g, estimate)',125)],
           'Okra and onion cooked down to a dry sabzi. Weighed as a 280 g finished batch; oil absorbed is assumed to be the full amount added.')
add_recipe('upma','Sooji upma, homemade','upma;rava upma;suji upma;sooji upma','Indian dishes','g',340,
           [('sooji',75),('peas',40),('onion',30),('carrots-raw',30),('canola-oil',8),('mustard-seed',1),('salt',1.8),('water',200)],
           [('katori (150 g, estimate)',150)],
           'Semolina cooked with vegetables, mustard seed and measured oil.')
add_recipe('lemon-rice','Lemon rice, homemade','nimbu chawal;chitranna;elumichai sadam;lemon rice','Indian dishes','g',330,
           [('rice-cooked',280),('lemon-juice',20),('peanuts',18),('canola-oil',8),('mustard-seed',1),('turmeric',1),('salt',1.5)],
           [('katori (150 g, estimate)',150)],
           'Cooked white rice with peanuts, lemon, mustard seed and measured oil.')
add_recipe('jeera-rice','Jeera rice, homemade','jeera rice;cumin rice;jeera chawal','Indian dishes','g',308,
           [('rice-cooked',300),('ghee',5),('cumin',2),('salt',1)], [('katori (150 g, estimate)',150)],
           'Cooked white rice finished with measured ghee and cumin.')
def add_label(ident, name, category, basis, source_amount, reported, aliases, portions, url, note):
    nutrients = {key: round(value * 100 / source_amount, 7) for key, value in reported.items()}
    data[ident] = dict(id=ident, name=name, category=category, basis=basis, nutrients=nutrients,
                       aliases=aliases.split(';'), portions=[dict(label=label,amount=amount) for label,amount in portions],
                       source=dict(label='Manufacturer nutrition label · India',url=url,note=note))

add_label('on-whey-drc','ON Gold Standard Whey · Double Rich Chocolate (India)','Supplements','g',30.4,
          dict(kcal=117,protein=24,carbs=3,fat=1,sugar=1,saturatedFat=0.5,sodium=50,addedSugar=0),
          'optimum nutrition whey;on whey;whey protein;gold standard whey;double rich chocolate',
          [('sachet / serving (30.4 g)',30.4)],
          'https://www.optimumnutrition.co.in/products/gold-standard-100-whey-protein-powder-double-rich-chocolate-1116202',
          'Reference is the 152 g India multipack. Uses the label’s per-sachet values; other flavors and packs may differ. Log milk and any additions separately.')
add_label('on-serious-mass-choc','ON Serious Mass · Chocolate 3 kg (India)','Supplements','g',334,
          dict(kcal=1243,protein=50,carbs=254,fat=3,sugar=20,saturatedFat=2,sodium=544,calcium=571,iron=1,potassium=434,vitaminC=5,vitaminB12=2,magnesium=50,zinc=2,vitaminD=7,addedSugar=0),
          'serious mass;on serious mass;mass gainer;optimum nutrition serious mass',
          [('scoop (167 g, half serving)',167),('full serving (334 g, about 2 scoops)',334)],
          'https://www.optimumnutrition.co.in/products/serious-mass-chocolate-1110152',
          'Uses the label’s per-334 g values. This formulation includes 3 g creatine per full serving. Log milk and any additions separately. Check your flavor and pack.')
add_label('on-creatine','ON Micronised Creatine · Unflavoured (India)','Supplements','g',3,
          dict(kcal=0,protein=0,carbs=0,fat=0,sugar=0,sodium=0,addedSugar=0),
          'creatine;creatine monohydrate;on creatine;optimum nutrition creatine;micronized creatine',
          [('scoop (3 g)',3)],
          'https://www.optimumnutrition.co.in/collections/strength-endurance/products/micronized-creatine-powder-unflavoured-1118952',
          '250 g unflavoured India variant. The 3 g scoop contains 3 g creatine monohydrate and is labeled 0 kcal. Other formulations may differ.')
add_label('milld-roti','MillD High Protein Atta · roti by dry flour','Grains & breads','g',100,
          dict(kcal=387.44,protein=46.16,carbs=45.48,fat=2.32,fiber=9,saturatedFat=0.58,sodium=4.04),
          'miild;miild protein roti;milld;milld atta;milld protein roti;milld high protein atta;milid;high protein roti;protein chapati',
          [('roti (33.3 g dry flour)',33.3),('roti (50 g dry flour)',50)],
          'https://milld.com/products/milld-high-protein-atta?variant=50956254216408',
          'Manufacturer’s 1 kg bag label. Grams mean dry flour, before adding water. One label-sized roti uses 33.3 g dry flour (about 129 kcal and 15.37 g protein). Log any oil or ghee separately. Total sugar is labeled below 2 g per 100 g; the exact amount is unavailable.')
add_label('amul-taaza-uht','Amul Taaza UHT toned milk · 3% fat','Dairy & alternatives','ml',100,
          dict(kcal=58.2,protein=3,carbs=4.8,fat=3,sugar=4.8,saturatedFat=2,sodium=37,calcium=110,addedSugar=0),
          'amul taaza;taaza;toned milk;3 percent milk',
          [('glass (200 mL)',200),('glass (250 mL)',250)],
          'https://old.amul.com/products/amul-uhttaaza-info.php',
          'Amul India’s shelf-stable UHT variant. Check the pack if you have chilled pouch milk or another brand.')
add_label('amul-sagar','Amul Sagar skimmed milk','Dairy & alternatives','ml',100,
          dict(kcal=36,protein=3.1,carbs=5,fat=0.4,sugar=5,saturatedFat=0.3,sodium=40,calcium=110,addedSugar=0),
          'amul sagar;skimmed milk;skim milk;fat free milk',
          [('glass (200 mL)',200),('glass (250 mL)',250)],
          'https://old.amul.com/products/amul-sagar-skimmed-milk-info.php',
          'Amul India’s chilled skimmed milk pouch.')
add_label('amul-high-protein-milk','Amul High Protein Milk · lactose free','Dairy & alternatives','ml',250,
          dict(kcal=225,protein=35,carbs=20,fat=0.5,sugar=20,saturatedFat=0.3,sodium=57,addedSugar=0),
          'amul protein milk;high protein milk;amul lactose free high protein milk',
          [('carton (250 mL)',250)],
          'https://old.amul.com/products/amul-high-protein-milk-info.php',
          'Amul India’s 250 mL high-protein vanilla carton. This is a different product from regular lactose-free milk.')

add_label('amul-gold-pouch','Amul Gold full cream milk · chilled pouch 6%', 'Dairy & alternatives','ml',100,
          dict(kcal=87,protein=3.2,carbs=5,fat=6,sugar=5,saturatedFat=3.8,sodium=42,calcium=120,vitaminB12=0.2,addedSugar=0),
          'amul gold;amul gold pouch;amul full cream milk;full fat milk;full cream milk;6 percent milk',
          [('glass (200 mL)',200),('glass (250 mL)',250)],
          'https://dudhsagardairy.coop/dairy/products/amul-gold/',
          'Dudhsagar Dairy’s refrigerated 500 mL–6 L poly-pack specification. The producer lists a separate regional pouch variant with slightly different values; check your own pack.')
add_label('amul-gold-uht','Amul Gold standardized milk · UHT carton 4.5%', 'Dairy & alternatives','ml',100,
          dict(kcal=71,protein=3,carbs=4.7,fat=4.5,sugar=4.7,saturatedFat=2.7,sodium=40,calcium=120,addedSugar=0),
          'amul gold;amul gold uht;amul gold tetra pack;amul gold long life;standardised milk;4.5 percent milk',
          [('glass (200 mL)',200),('glass (250 mL)',250)],
          'https://dudhsagardairy.coop/dairy/products/amul-gold-uht-milk/',
          'Dudhsagar Dairy’s shelf-stable 4.5% homogenised milk, distinct from the chilled 6% pouch.')
add_label('amul-taaza-pouch','Amul Taaza toned milk · chilled pouch 3%', 'Dairy & alternatives','ml',100,
          dict(kcal=58,protein=3,carbs=4.7,fat=3,sugar=4.7,saturatedFat=1.8,sodium=40,calcium=110,addedSugar=0),
          'amul taaza;amul taaza pouch;taaza toned milk;toned milk',
          [('glass (200 mL)',200),('glass (250 mL)',250)],
          'https://dudhsagardairy.coop/dairy/products/amul-taaza/',
          'Dudhsagar Dairy’s refrigerated 160 mL poly-pack reference. Formulations can differ by package.')
add_label('amul-fresh-paneer','Amul Fresh Paneer · block','Dairy & alternatives','g',100,
          dict(kcal=312,protein=20,carbs=4,fat=24,sugar=4,saturatedFat=14.4,sodium=24,calcium=480,addedSugar=0),
          'amul paneer;amul fresh paneer;fresh paneer',
          [('label portion (50 g)',50)],
          'https://sabardairy.org/product/amul-fresh-paneer/',
          'Sabar Dairy’s Amul Fresh Paneer block label. Check your pack before using for another paneer.')
add_label('amul-malai-paneer','Amul Malai Paneer · frozen','Dairy & alternatives','g',100,
          dict(kcal=323,protein=20,carbs=4.5,fat=25,saturatedFat=15,calcium=480,addedSugar=0),
          'amul paneer;amul malai paneer;malai paneer;frozen paneer',
          [('portion (50 g)',50)],
          'https://old.amul.com/products/amul-malaipaneer-info.php',
          'Amul’s frozen diced or block Malai Paneer specification.')
add_label('amul-high-protein-paneer','Amul High Protein Paneer · canned','Dairy & alternatives','g',100,
          dict(kcal=170,protein=25,carbs=4,fat=6,sugar=4,saturatedFat=4,sodium=190,calcium=350,addedSugar=0),
          'amul paneer;amul high protein paneer;high protein paneer;low fat paneer',
          [('label portion (50 g)',50)],
          'https://old.amul.com/products/amul-HP-tin-paneer-info.php',
          'Amul’s 400 g tin specification. Log the portion of paneer eaten.')
add_label('amul-dahi','Amul Masti Dahi · plain','Dairy & alternatives','g',100,
          dict(kcal=61.5,protein=4,carbs=4.4,fat=3.1,saturatedFat=2,calcium=138,addedSugar=0),
          'amul masti dahi;amul curd;masti curd;dahi',
          [('small katori (100 g, estimate)',100)],
          'https://old.amul.com/products/amul-mastidahi-info.php',
          'Plain toned-milk curd. Milk sugar is naturally present; total sugar is not listed in this table.')
add_label('amul-paneer-paratha','Amul Paneer Paratha · frozen','Indian dishes','g',100,
          dict(kcal=305,protein=13,carbs=26,fat=16.5,sugar=3,saturatedFat=9,sodium=450,addedSugar=0.4),
          'amul paneer paratha;frozen paneer paratha;paneer parantha',
          [('paratha (125 g)',125)],
          'https://old.amul.com/products/amul-paneer-paratha.php',
          'Amul’s frozen 4 × 125 g pack. Log any oil, butter or ghee added during cooking separately.')
add_label('poha-dry','Thick poha / rice flakes · Total Organics','Grains & breads','g',100,
          dict(kcal=352,protein=8,carbs=76,fat=1,fiber=1.3,sugar=0,saturatedFat=0.2,iron=0.5,calcium=5),
          'poha;rice flakes;flattened rice;aval;avalakki;chira;chiura;atukulu',
          [('dry portion (40 g)',40)],
          'https://totalorganics.in/product/poha/',
          'Manufacturer’s thick poha values. Weigh dry before rinsing or adding toppings.')
add_label('ragi-flour','Ragi flour · Dhatu Organic','Grains & breads','g',100,
          dict(kcal=336,protein=7.3,carbs=72,fat=1.9,fiber=11.5,sugar=1.2,saturatedFat=0.3,sodium=11,calcium=364,iron=3.9,magnesium=137),
          'ragi;ragi atta;finger millet flour;nachni;mandua;kezhvaragu',
          [('dry portion (30 g)',30)],
          'https://www.dhatuorganics.com/products/organic-ragi-flour-500g',
          'Manufacturer’s dry finger millet flour values. Weigh before adding water.')
add_label('bajra-dry','Pearl millet / bajra · Dhatu Organic','Grains & breads','g',100,
          dict(kcal=361,protein=11.6,carbs=67,fat=5,fiber=1.3,sugar=0.5,saturatedFat=0.9,calcium=42,iron=8,magnesium=114),
          'bajra;pearl millet;kambu;bhakri flour reference',
          [('dry portion (30 g)',30)],
          'https://www.dhatuorganics.com/products/organic-pearl-millet-500g',
          'Manufacturer’s specific dry pearl millet product. Values can differ from other bajra products.')
add_label('makhana','Plain popped makhana · Makhanza','Snacks','g',100,
          dict(kcal=358,protein=9.8,carbs=78,fat=0.5,fiber=7.7,sugar=0.5,saturatedFat=0.1,sodium=9.4,addedSugar=0),
          'makhana;fox nuts;foxnuts;phool makhana',
          [('snack portion (25 g)',25)],
          'https://makhanza.co.in/product/raw-popped-makhana/',
          'Plain popped fox nuts from the 100 g pack. Log oil or seasonings separately.')
add_label('jaggery','Sugarcane jaggery powder · Dhatu Organic','Oils & seasonings','g',100,
          dict(kcal=383,protein=0.4,carbs=98,fat=0.1,sugar=97,iron=11),
          'jaggery;gur;gud;gul;vellam',
          [('label portion (10 g)',10)],
          'https://www.dhatuorganics.com/products/organic-jaggery-powder-500g',
          'Manufacturer’s dry sugarcane jaggery. When used as a sweetener, count its sugars as added in the finished recipe.')

add_recipe('kanda-poha','Kanda poha, homemade','poha;kanda poha;batata poha;poha upma;aval upma;flattened rice breakfast','Indian dishes','g',330,
           [('poha-dry',85),('onion',60),('potato-boiled',55),('peanuts',12),('canola-oil',9),('lemon-juice',10),('mustard-seed',1),('turmeric',0.8),('salt',1.5),('water',100)],
           [('katori (150 g, estimate)',150)],
           'Onion and potato poha with peanuts. Finished weight includes water absorbed by the flakes.')
add_recipe('besan-chilla','Besan chilla, homemade','besan cheela;besan chilla;chickpea pancake;pudla','Indian dishes','g',180,
           [('besan',65),('onion',30),('tomato',30),('cilantro',5),('canola-oil',7),('cumin',0.5),('salt',1),('water',65)],
           [('chilla (90 g, estimate)',90)],
           'Savory besan batter with onion and tomato. Batch makes two pancakes, and the oil added to the pan is counted in full.')
add_recipe('ragi-roti','Ragi roti, homemade','ragi roti;ragi rotti;nachni bhakri;finger millet roti','Grains & breads','g',52,
           [('ragi-flour',35),('water',24),('salt',0.3)], [('roti (52 g, estimate)',52)],
           'One plain roti made with 35 g dry ragi flour and no oil or ghee.')
add_recipe('sarson-saag','Sarson ka saag, homemade','sarson ka saag;sarson saag;mustard greens curry','Indian dishes','g',400,
           [('mustard-greens-cooked',230),('spinach-cooked',130),('garlic',8),('ginger',6),('makki-atta',12),('ghee',8),('salt',1.5),('water',20)],
           [('katori (150 g, estimate)',150)],
           'Mustard greens and spinach thickened with corn flour and finished with measured ghee.')
add_recipe('aloo-matar','Aloo matar curry, homemade','aloo matar;alu matar;potato peas curry','Indian dishes','g',420,
           [('potato-boiled',150),('peas',100),('onion',45),('tomato',100),('canola-oil',9),('cumin',1),('salt',1.5),('water',30)],
           [('katori (150 g, estimate)',150)],
           'Potato and green peas in a tomato-onion gravy with measured oil.')
add_recipe('baingan-bharta','Baingan bharta, homemade','baigan bharta;baingan bharta;mashed eggplant curry','Indian dishes','g',350,
           [('eggplant-raw',330),('onion',55),('tomato',70),('garlic',5),('canola-oil',10),('cumin',1),('salt',1.5)],
           [('katori (125 g, estimate)',125)],
           'Eggplant, onion and tomato cooked down to a thick mash. Finished weight is modeled from the batch.')
add_recipe('lauki-sabzi','Lauki sabzi, homemade','lauki sabzi;ghiya sabzi;bottle gourd curry;dudhi bhaji','Indian dishes','g',330,
           [('bottle-gourd-cooked',240),('onion',45),('tomato',65),('canola-oil',8),('cumin',1),('salt',1.3)],
           [('katori (125 g, estimate)',125)],
           'Bottle gourd with onion and tomato, cooked down with measured oil.')
add_recipe('sambar','Toor dal sambar, homemade','sambar;sambhar;sambaar;drumstick sambar','Indian dishes','g',500,
           [('toor-cooked',180),('drumstick-cooked',70),('tomato',70),('onion',45),('tamarind',10),('canola-oil',6),('mustard-seed',1),('turmeric',1),('salt',2),('water',150)],
           [('katori (150 g, estimate)',150)],
           'Toor dal with edible moringa pod portions and tamarind. Water and oil levels vary by recipe.')
add_recipe('paneer-bhurji','Paneer bhurji, homemade','paneer bhurji;paneer bhurjee;scrambled paneer','Indian dishes','g',340,
           [('paneer',180),('onion',70),('tomato',90),('green-capsicum',45),('canola-oil',8),('cumin',1),('salt',1.3)],
           [('katori (125 g, estimate)',125)],
           'Crumbled paneer with vegetables and measured oil. Change the paneer ingredient to match your brand.')
add_recipe('anda-bhurji','Egg bhurji, homemade','anda bhurji;egg bhurji;masala scrambled eggs;anda bhurjee','Indian dishes','g',210,
           [('egg-raw',150),('onion',40),('tomato',45),('green-chili',4),('canola-oil',6),('cumin',0.5),('salt',0.9)],
           [('serving (105 g, estimate)',105)],
           'Three eggs in a two-serving batch with onion, tomato and measured oil.')
add_recipe('chicken-keema','Chicken keema, homemade','chicken keema;chicken kheema;minced chicken curry;murgh keema','Indian dishes','g',420,
           [('ground-chicken',300),('onion',75),('tomato',100),('peas',45),('ginger',5),('garlic',7),('canola-oil',10),('cumin',1),('salt',1.8)],
           [('katori (150 g, estimate)',150)],
           'Minced chicken cooked with peas and tomato. Choose your own mince when its fat content differs.')
add_recipe('coconut-chutney','Coconut chutney, homemade','coconut chutney;nariyal chutney;thengai chutney','Indian dishes','g',175,
           [('coconut',90),('water',75),('ginger',4),('green-chili',4),('canola-oil',4),('mustard-seed',0.5),('salt',0.8)],
           [('tablespoon (15 g, estimate)',15)],
           'Fresh coconut ground with water, then tempered with measured oil.')
add_recipe('banana-shake','Banana milk shake, homemade','banana shake;banana milkshake;kela shake;banana smoothie','Drinks','ml',320,
           [('banana',100),('milk-whole',230)], [('glass (320 mL, estimate)',320)],
           'Banana blended with about 225 mL whole cow’s milk. No sweetener is included.', added_sugar=0)

add_recipe('shahi-paneer','Shahi paneer, homemade','shahi paneer;shahi panir;royal paneer;paneer in cashew cream gravy','Indian dishes','g',600,
           [('paneer',230),('tomato',160),('onion',90),('curd',70),('cashews',25),('cream',35),('ghee',10),
            ('ginger',6),('garlic',6),('cumin',1.5),('cardamom',1),('salt',2),('water',40)],
           [('katori (150 g, estimate)',150),('larger serving (225 g, estimate)',225)],
           'Tomato-style shahi paneer with curd, cashews, cream and ghee. Richness changes with the dairy and nut amounts.',
           reference='https://www.sanjeevkapoor.com/Recipe/shahi-paneer-12062752')
add_recipe('palak-paneer-home','Palak paneer, homemade','palak paneer;palak panir;spinach paneer;paneer in spinach gravy','Indian dishes','g',570,
           [('spinach-cooked',280),('paneer',190),('onion',60),('tomato',60),('canola-oil',10),('cream',20),
            ('garlic',6),('ginger',6),('green-chili',4),('cumin',1.5),('salt',1.8)],
           [('katori (150 g, estimate)',150),('larger serving (225 g, estimate)',225)],
           'Cooked spinach gravy with paneer and a little cream. Cream and oil can differ in a takeaway version.',
           reference='https://www.vegrecipesofindia.com/palak-paneer/')
add_recipe('aloo-sabzi','Aloo sabzi / jeera aloo, homemade dry','aloo sabzi;aloo sabji;aloo subzi;alu sabzi;jeera aloo;dry potato sabzi;cumin potatoes','Indian dishes','g',390,
           [('potato-boiled',370),('canola-oil',18),('ginger',6),('cumin',3),('coriander-seed',2),
            ('green-chili',3),('turmeric',1),('lemon-juice',8),('cilantro',5),('salt',1.6)],
           [('katori (125 g, estimate)',125),('larger katori (150 g, estimate)',150)],
           'Dry spiced potato dish with cumin. One 125 g katori includes about 5.8 g of added cooking oil under this model.',
           reference='https://www.indianhealthyrecipes.com/jeera-aloo-recipe/')
add_recipe('aloo-tamatar','Aloo tamatar sabzi, homemade gravy','aloo tamatar;aloo sabzi gravy;aloo ki sabzi;potato curry;wet aloo sabzi','Indian dishes','g',600,
           [('potato-boiled',330),('tomato',140),('onion',70),('canola-oil',12),('ginger',5),('garlic',6),
            ('cumin',2),('turmeric',1),('coriander-seed',2),('salt',1.8),('water',80)],
           [('katori (150 g, estimate)',150)],
           'Potatoes simmered with onion and tomato gravy. This modeled yield includes the gravy.',
           reference='https://www.indianhealthyrecipes.com/potato-curry-aloo-sabzi/')
add_recipe('bhatura','Bhatura, homemade fried bread','bhatura;bhature;batura;bature;bhatoora;bhatoore;bhatura bread','Grains & breads','g',300,
           [('maida',160),('sooji',30),('curd',90),('water',48),('sugar',7),('salt',2),('baking-soda',1),('canola-oil',40)],
           [('piece (75 g, estimate)',75),('large piece (100 g, estimate)',100)],
           'Four 75 g fried breads. The model counts 10 g oil per piece, including 2.5 g in the dough and 7.5 g absorbed during frying. Actual uptake can vary substantially.',
           added_sugar=7, reference='https://www.vegrecipesofindia.com/bhatura-recipe-bhature-bhatura/')
add_recipe('chole-bhatura','Chole bhatura, homemade plate','chola bhatura;chole bhature;chola bhature;chana bhatura;chana bhature;chole bhatura;chhole bhature;choley bhature;chole bature','Indian dishes','g',225,
           [('chole',150),('bhatura',75)],
           [('plate with 1 bhatura (225 g, estimate)',225)],
           'One plate means 150 g chickpea curry and one 75 g fried bread. Log extra bhatura separately. Oil uptake, serving size and accompaniments vary.',
           added_sugar=1.75, reference='https://www.vegrecipesofindia.com/chole-bhature/')
add_recipe('aloo-gobi','Aloo gobi sabzi, homemade','aloo gobi;aloo gobhi;potato cauliflower sabzi;aloo phool gobi','Indian dishes','g',410,
           [('potato-boiled',160),('cauliflower',180),('tomato',65),('onion',40),('canola-oil',12),
            ('ginger',6),('cumin',2),('turmeric',1),('salt',1.6)],
           [('katori (125 g, estimate)',125)],
           'Potato and cauliflower without peas, cooked down with spices and measured oil.',
           reference='https://www.indianhealthyrecipes.com/aloo-gobi-recipe/')
add_recipe('gobi-matar','Gobi matar sabzi, homemade','gobi matar;gobhi matar;cauliflower peas sabzi;phool gobi matar','Indian dishes','g',410,
           [('cauliflower',220),('peas',100),('onion',55),('tomato',65),('canola-oil',12),('ginger',6),
            ('garlic',6),('cumin',2),('turmeric',1),('salt',1.6)],
           [('katori (125 g, estimate)',125)],
           'Cauliflower and green peas without potatoes, with a light onion-tomato masala.',
           reference='https://www.vegrecipesofindia.com/gobi-matar-recipe-gobi-recipes/')
add_recipe('gajar-matar','Gajar matar sabzi, homemade','gajar matar;gajar mutter;carrot peas sabzi;gajar matar ki sabzi','Indian dishes','g',355,
           [('carrots-cooked',215),('peas',125),('canola-oil',10),('ginger',6),('cumin',2),('turmeric',0.5),('salt',1.3)],
           [('katori (125 g, estimate)',125)],
           'Carrot and peas without potatoes, tossed with cumin, ginger and measured oil.')
add_recipe('kaddu-sabzi','Kaddu sabzi, homemade','kaddu sabzi;kaddu ki sabji;kaddu subzi;pumpkin sabzi;sitaphal sabzi;petha sabzi','Indian dishes','g',340,
           [('pumpkin-cooked',320),('canola-oil',11),('ginger',5),('cumin',2),('turmeric',0.8),('lemon-juice',8),('salt',1.3)],
           [('katori (125 g, estimate)',125)],
           'Spiced orange pumpkin with lemon and measured oil. This version uses pumpkin, since petha can also mean ash gourd.',
           reference='https://www.indianhealthyrecipes.com/pumpkin-curry-gummadikaya-kura-kaddu-ki-subji/')
add_recipe('arbi-sabzi','Arbi sabzi, homemade','arbi sabzi;arvi sabzi;arbi fry;arbi ki sabji;taro root sabzi;colocasia sabzi','Indian dishes','g',320,
           [('taro-cooked',315),('canola-oil',14),('cumin',2),('coriander-seed',2),('turmeric',0.8),('lemon-juice',8),('salt',1.3)],
           [('katori (125 g, estimate)',125)],
           'Cooked taro root finished in measured oil and spices. Some fried versions absorb more oil.',
           reference='https://www.vegrecipesofindia.com/sukhi-arbi-recipe-sukhi-arbi/')
add_recipe('matar-sabzi','Matar ki sabzi, homemade','matar ki sabzi;matar sabzi;mutter sabzi;green peas sabzi;dry peas sabzi','Indian dishes','g',300,
           [('peas',285),('canola-oil',9),('cumin',2),('ginger',4),('green-chili',2),('lemon-juice',6),('salt',1.3)],
           [('katori (125 g, estimate)',125)],
           'Dry sabzi made with tender green peas, cumin and measured oil.',
           reference='https://www.vegrecipesofindia.com/matar-ki-sabji/')
add_recipe('mixed-veg-sabzi','Mixed vegetable sabzi, homemade','mixed veg sabzi;mix veg;mix veg sabji;vegetable sabzi;mixed vegetable curry','Indian dishes','g',500,
           [('cauliflower',130),('carrots-cooked',85),('green-beans',70),('peas',70),('green-capsicum',45),
            ('onion',55),('tomato',75),('canola-oil',12),('cumin',2),('turmeric',0.8),('salt',1.8)],
           [('katori (125 g, estimate)',125),('larger katori (150 g, estimate)',150)],
           'Cauliflower, carrots, beans, peas and capsicum in a tomato-onion base. This version contains no cream, paneer or potatoes.',
           reference='https://www.vegrecipesofindia.com/mix-veg-recipe-indian/')

cofid_url = 'https://www.gov.uk/government/publications/composition-of-foods-integrated-dataset-cofid'
cofid_keys = ('kcal', 'protein', 'carbs', 'fat', 'fiber', 'sugar', 'saturatedFat', 'sodium',
              'calcium', 'iron', 'potassium', 'vitaminC', 'vitaminB12', 'magnesium', 'zinc', 'vitaminD')
# CoFID 2021 sheets 1.3, 1.4, 1.5 and 1.8. Blank and trace cells are omitted.
cofid_rows = """13-243|methi-leaves|Fenugreek leaves, fresh raw|methi leaves;methi patta;fresh methi|0|35,4.6,4.8,0.2,,,,76,140,8.8,31,91,0,59,,0
13-256|tinda-raw|Tinda / round gourd, raw|raw tinda;tinda gourd;round gourd;apple gourd|0|21,1.4,3.6,0.2,,2.8,,35,25,0.9,24,18,0,14,,0
15-625|tori-sabzi|Tori / turai sabzi, CoFID reference|tori sabzi;turai sabzi;turai ki sabji;tori ki subji;tori subzi;nenua sabzi|125|108,1.9,3.9,9.5,3,3.9,1.03,459,36,1.18,382,2,0,27,0.3,0
15-626|tinda-sabzi|Tinda sabzi, CoFID reference|tinda sabzi;tinda sabji;tinda subji;tinda masala;round gourd sabzi|125|95,1.6,4.1,8.1,2.8,4.1,0.83,408,34,0.6,279,1,0,21,0.3,0
15-788|tinda-aloo|Tinda and potato curry, CoFID reference|tinda aloo;aloo tinda;tinda aloo sabzi;round gourd potato curry|150|74,1.6,8.5,3.9,,3.5,0.56,43,23,0.71,232,9,0,17,,0
15-628|aloo-methi|Aloo methi sabzi, CoFID reference|methi aloo;aloo methi;methi sabzi;potato fenugreek sabzi|125|142,2.7,10.1,10.4,2.9,1.5,1.06,537,70,1.69,342,4,0,26,0.3,0
15-671|cabbage-sabzi|Patta gobi / cabbage sabzi, CoFID reference|band gobi;band gobhi;patta gobi;patta gobhi;cabbage sabzi;patta gobhi ki sabji|125|77,2.8,6.8,4.5,4.4,5.9,0.32,8,62,0.66,341,32,0,17,0.3,0
15-675|cabbage-aloo|Cabbage and potato sabzi, CoFID reference|aloo patta gobi;band gobi aloo;cabbage potato sabzi|125|108,2.7,9.6,6.8,4.1,4.9,0.48,7,52,0.61,384,23,0,19,0.3,0
15-677|gajar-aloo-matar|Gajar aloo matar sabzi, CoFID reference|gajar aloo matar;carrot potato pea sabzi|125|128,2.1,12.9,7.9,4.1,6.7,0.59,17,30,0.67,295,6,0,17,0.3,0
15-024|beans-sabzi|French beans sabzi, CoFID reference|beans sabzi;green beans sabzi;french beans sabji;french beans bhaji|125|91,2.2,5,7.6,,4.1,0.7,460,46,1.9,280,7,0,26,0.3,0
15-756|karela-sabzi|Karela sabzi, CoFID reference|karela sabzi;karela sabji;karela curry;bitter gourd sabzi|125|111,1.6,4.6,9.7,1.2,3.3,1.38,2,27,1.11,327,64,0,26,0.3,0
15-627|bhindi-cofid|Bhindi sabzi, CoFID reference|bhindi cofid;okra onion tomato curry;bhindi ki subji|125|71,2.9,4.9,4.6,7.2,4.4,0.4,437,108,0.78,372,,0,56,0.6,0
15-683|sarson-saag-cofid|Mustard greens and spinach saag, CoFID reference|saag reference;sarson saag reference;mustard spinach saag|150|84,3.1,3.8,6.5,,1.6,3.75,135,163,2.6,458,30,0,47,,0.1
15-048|mixed-veg-punjabi|Punjabi mixed vegetable bhaji, CoFID reference|punjabi mix veg;punjabi mixed sabzi;vegetable bhaji|125|120,3.5,8.2,8.6,,5.5,1,390,40,1.5,340,12,0,23,0.6,0
11-911|poori|Poori / puri, CoFID fried bread reference|poori;puri;fried chapati;whole wheat puri|30|366,7.2,36.5,22.3,3.5,1.2,2.66,279,109,2.47,180,0,0,39,1.1,0"""
for line in cofid_rows.splitlines():
    code, ident, name, aliases, portion, values = line.split('|')
    nutrients = {key: float(value) for key, value in zip(cofid_keys, values.split(','), strict=True) if value}
    portion = int(portion)
    category = 'Vegetables' if portion == 0 else 'Grains & breads' if ident == 'poori' else 'Indian dishes'
    if 'fiber' in nutrients:
        # CoFID's user guide recommends dividing monosaccharide equivalents by 1.05
        # for mixed carbohydrate before adding AOAC dietary fibre to approximate total.
        nutrients['carbs'] = round(nutrients['carbs'] / 1.05 + nutrients['fiber'], 2)
        carb_note = 'Estimated total carbs use reported available carbs ÷ 1.05 plus measured fibre.'
    else:
        carb_note = 'Carbs are available carbohydrate as published, exclude fibre and are not directly comparable to total carbs.'
    source = dict(label='UK Public Health England · CoFID 2021 reference', url=cofid_url,
                  note=f'CoFID food code {code}. {carb_note} '
                       'Reference values vary with ingredients, oil and preparation. Crown copyright, OGL v3.0.')
    data[ident] = dict(id=ident, name=name, category=category, basis='g', nutrients=nutrients,
                       aliases=aliases.split(';'), source=source)
    if portion:
        unit = 'piece' if ident == 'poori' else 'katori'
        data[ident]['portions'] = [dict(label=f'{unit} ({portion} g, estimate)', amount=portion)]

data['chole']['aliases'].extend(['chola','choley','chhole'])
data['palak-paneer']['aliases'].extend(['restaurant palak paneer','delivery palak paneer','zomato palak paneer'])
data['sabzi']['aliases'].extend(['aloo gobi matar','aloo gobhi matar','potato cauliflower pea sabzi'])
data['bhindi-sabzi']['aliases'].extend(['bhindi sabji','bhindi subzi','okra curry'])
data['lauki-sabzi']['aliases'].extend(['lauki ki sabzi','lauki subzi','dudhi sabzi'])
data['sabzi-reference']['aliases'].extend(['restaurant vegetable curry','delivery vegetable curry','zomato vegetable curry'])
data['chicken-curry']['aliases'].extend(['restaurant chicken curry','delivery chicken curry','zomato chicken curry'])
data['biryani-chicken']['aliases'].extend(['restaurant chicken biryani','delivery chicken biryani','zomato chicken biryani'])

order = ['roti','dal','curd','sabzi','chai','rice-cooked','egg-boiled','paneer','idli','dosa','chole','rajma','khichdi',
         'milld-roti','on-whey-drc','on-serious-mass-choc','on-creatine','amul-taaza-uht','amul-sagar','amul-high-protein-milk','amul-gold-pouch','amul-gold-uht']
catalog = [data[key] for key in order] + [record for key,record in data.items() if key not in order]
path = options.output
path.parent.mkdir(parents=True, exist_ok=True)
path.write_text('[\n' + ',\n'.join('  '+json.dumps(item,ensure_ascii=False,separators=(',',': ')) for item in catalog) + '\n]\n',encoding='utf-8')
print(f'Final catalog: {len(catalog)} entries, {path.stat().st_size:,} bytes')
